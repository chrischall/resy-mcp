import { dirname, join } from 'path';
import { createTokenCache, reportCacheWriteFailure } from './token-cache.js';
import { resolveApiKey } from './api-key.js';
import { fileURLToPath } from 'url';
import {
  detectEdgeBlock,
  EdgeBlockedError,
  readEnvVar,
  loadDotenvSafely,
  parseBoolEnv,
  parseRetryAfterMs,
  truncateErrorMessage,
  withAmbientCancellation,
} from '@chrischall/mcp-utils';
import { TokenManager } from '@chrischall/mcp-utils/session';
import { mintTokenViaFetchproxy } from './auth-fetchproxy.js';

// quiet: true (set inside loadDotenvSafely) suppresses dotenv v17's stdout
// telemetry banner, which Claude Desktop would otherwise try to parse as a
// JSON-RPC message and reject with "Invalid JSON-RPC message". A missing
// dotenv module (mcpb bundle) is a silent no-op — creds come from
// process.env / mcp_config.env in that case.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

/**
 * Read an env var defensively (trim whitespace; treat blank, `undefined`/`null`
 * sentinels, and unsubstituted `${FOO}` placeholders as unset). Thin alias over
 * the fleet-shared `readEnvVar` so the call sites below stay terse.
 */
function readVar(key: string): string | undefined {
  return readEnvVar(key);
}

const BASE_URL = 'https://api.resy.com';
// Resy auth tokens are opaque, carry no published TTL, and have no separate
// refresh token — a "refresh" is just re-running the three-path mint. So:
//   • The TokenManager is seeded with a placeholder access token that is
//     already "expired" (expiresAt: 0), so the FIRST getAccessToken() mints
//     lazily via the refresh callback — preserving the prior lazy-auth timing.
//   • After a successful mint we report expiresAt: +Infinity, so the token is
//     cached indefinitely and never proactively re-minted; only a reactive
//     401/419/auth-500 (handled below) clears and re-mints it.
//   • TokenManager.refreshNow() refuses to run without a refresh token, so we
//     hand it a constant sentinel as the "refresh token". It is never sent on
//     the wire — it only keeps the single-flight refresh path armed.
const REFRESH_SENTINEL = 'resy-reauth';
// Far-future rather than Infinity, and that matters beyond taste: JSON has no
// infinity literal, so a persisted Infinity is written as `null` and read back
// as a non-number. The token cache would then be written on every mint and
// rejected on every load — doing nothing, silently. Any finite value past the
// life of a session behaves identically to Infinity for `needsRefresh`.
const NEVER_EXPIRES = Date.UTC(9999, 0, 1);

const SPOOF_HEADERS = {
  Origin: 'https://resy.com',
  Referer: 'https://resy.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
} as const;

/**
 * Per-attempt deadline for one api.resy.com round trip (headers AND body).
 * Every call used to be a bare fetch(): a stalled socket hung the tool call
 * forever, and a slow POST /3/book could outlive the MCP client's own
 * tool-call timeout — the model saw a failure, the booking completed on
 * Resy's side, and a retry booked twice (fleet-audit#227). Comfortably above
 * a slow-but-healthy Resy response, below the ~60s client timeouts.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * 429 backoff: honor Resy's `Retry-After` (delta-seconds), falling back to the
 * historical fixed 2s when it is absent or unparseable, and capped so a CDN
 * asking for an hour can't pin a tool call open.
 */
const RATE_LIMIT_DEFAULT_DELAY_MS = 2_000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

export interface ResyClientOptions {
  /** Override the per-request deadline. Tests use a short one. */
  requestTimeoutMs?: number;
}

/** One answered attempt, read while its body was still in hand. */
interface Captured {
  text: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers: Headers;
}

/**
 * Parse a 2xx body. A WAF/HTML interstitial served with a 200 used to escape
 * as a bare "Unexpected token <" naming no endpoint (fleet-audit#682).
 */
function parseJsonBody<T>(text: string, method: string, path: string): T {
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Resy returned a non-JSON response from ${method} ${path}: ${truncateErrorMessage(text)}`
    );
  }
}

export type ResyBody =
  | undefined
  | Record<string, unknown>
  | URLSearchParams;

export class ResyClient {
  private readonly apiKey: string;
  private readonly tokens: TokenManager;
  private readonly requestTimeoutMs: number;

  constructor(options: ResyClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.apiKey = resolveApiKey();
    // Race-safe token lifecycle from the shared session kit. The refresh
    // callback runs resy's three-path mint; single-flight + the usedToken
    // double-refresh guard live inside TokenManager.withAuth (see request()).
    // Minting and re-minting are the same operation, and the FUNCTION form of
    // `initial` is what makes the cache readable — the eager object form skips
    // persistence entirely, so the expired placeholder that used to sit here
    // would have meant a cache written and never read.
    const mint = async (): Promise<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }> => ({
      accessToken: await this.mintToken(),
      refreshToken: REFRESH_SENTINEL,
      expiresAt: NEVER_EXPIRES,
    });
    this.tokens = new TokenManager({
      initial: mint,
      refresh: mint,
      persistence: createTokenCache() ?? undefined,
      onPersistError: reportCacheWriteFailure,
      // A failed mint IS a failed login here, so the library's
      // re-mint-on-revoked recovery would just repeat the call that failed.
      isRefreshRevoked: () => false,
    });
  }

  /**
   * One bounded round trip: fetch + read the body under a per-attempt timeout
   * combined with the MCP caller's cancellation (ambient, installed per tool
   * call by mcp-utils' runMcp). An abort surfaces as a plain Error naming the
   * call; for anything but a GET it also says the outcome is UNKNOWN, because
   * Resy may already have acted on it — the model must check before retrying
   * rather than book twice.
   */
  private async timedFetch(
    method: string,
    path: string,
    url: string,
    init: RequestInit
  ): Promise<{ res: Response; text: string }> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = withAmbientCancellation(timeout) ?? timeout;
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, { ...init, signal });
      text = await res.text();
    } catch (err) {
      if (!signal.aborted) throw err;
      const what = timeout.aborted
        ? `Resy request timed out after ${Math.round(this.requestTimeoutMs / 1000)}s for ${method} ${path}`
        : `Resy request cancelled by the caller for ${method} ${path}`;
      const unknown =
        method.toUpperCase() === 'GET'
          ? ''
          : ' — the outcome is UNKNOWN: Resy may already have completed it. Check its effect ' +
            '(e.g. resy_list_reservations after a booking or cancel) before retrying.';
      throw new Error(what + unknown, { cause: err });
    }
    // A CDN/WAF refusal page never reached Resy, so no credential was judged
    // (chrischall/mcp-host#1015). Decide that HERE, while the body is still in
    // hand: the Response handed on to TokenManager.withAuth has already been
    // read, so its own block check sees nothing, and a 401 block page used to
    // spend a re-mint (a real password login or a bridge round trip) and then
    // read as a rejected credential. Throwing propagates through withAuth
    // untouched — no refresh, no replay.
    if (!res.ok) {
      const edge = detectEdgeBlock({ body: text, headers: res.headers, status: res.status });
      if (edge) throw new EdgeBlockedError(res.status, edge.vendor, { service: 'Resy', method, path });
    }
    return { res, text };
  }

  async request<T>(method: string, path: string, body?: ResyBody): Promise<T> {
    const isForm = body instanceof URLSearchParams;
    const buildHeaders = (token: string): Record<string, string> => {
      const headers: Record<string, string> = {
        Authorization: `ResyAPI api_key="${this.apiKey}"`,
        'x-resy-auth-token': token,
        'x-resy-universal-auth': token,
        ...SPOOF_HEADERS,
      };
      if (body !== undefined) {
        headers['Content-Type'] = isForm
          ? 'application/x-www-form-urlencoded'
          : 'application/json';
      }
      return headers;
    };
    const init: Omit<RequestInit, 'headers'> =
      body !== undefined
        ? { method, body: isForm ? (body as URLSearchParams).toString() : JSON.stringify(body) }
        : { method };

    // Route the request (and its single reactive re-mint + replay) through the
    // shared TokenManager. withAuth refreshes proactively when needed, replays
    // exactly once on a 401, and the usedToken comparison stops a concurrent
    // burst of 401s from double-refreshing. Resy also flags 419 and auth-shaped
    // 500s as auth failures, which withAuth can't see (it only keys on 401), so
    // we normalize them to a synthetic 401 to drive the same one-shot replay.
    const attempt = async (): Promise<Captured> => {
      let captured: Captured | null = null;
      await this.tokens.withAuth(async (token) => {
        const { res, text } = await this.timedFetch(method, path, `${BASE_URL}${path}`, {
          ...init,
          headers: buildHeaders(token),
        });
        captured = { text, status: res.status, statusText: res.statusText, ok: res.ok, headers: res.headers };
        // Narrow: match only auth-scoped phrases, not any mention of "token"
        // (Resy occasionally says things like "book_token expired" which is a
        // different failure and shouldn't trigger a re-login).
        if (res.status === 500 && method.toUpperCase() !== 'GET' && looksLikeAuthFailure(500, text)) {
          // A 500 on a write is ambiguous: Resy may have acted (created the
          // reservation) before failing. Replaying it would re-send the write
          // past the checks that ran before the first attempt — e.g. resy_book's
          // duplicate guard (fleet-audit#1099). Surface it like a timed-out
          // write instead: no re-mint, no replay, outcome UNKNOWN.
          throw new ResyApiError(
            res.status,
            res.statusText,
            method,
            path,
            text,
            ' — Resy blamed authentication, but the outcome is UNKNOWN: it may already have completed it. ' +
              'Check its effect (e.g. resy_list_reservations after a booking or cancel) before retrying.'
          );
        }
        if (looksLikeAuthFailure(res.status, text) && res.status !== 401) {
          // Re-wrap a 419 / auth-500 as a 401 so TokenManager.withAuth clears +
          // re-mints + replays once. The real status/body stay in `captured`.
          return new Response(null, { status: 401, statusText: res.statusText });
        }
        return res;
      });
      return captured!;
    };

    let result = await attempt();

    if (result.status === 429) {
      // 429 backoff, then ONE more attempt — through withAuth like the first,
      // so a token that lapsed during the wait is re-minted rather than failing
      // the call outright (fleet-audit#682).
      const delayMs = parseRetryAfterMs(result.headers.get('retry-after'), {
        defaultMs: RATE_LIMIT_DEFAULT_DELAY_MS,
        capMs: RATE_LIMIT_MAX_DELAY_MS,
      });
      await new Promise<void>((r) => setTimeout(r, delayMs));
      result = await attempt();
      if (result.status === 429) {
        throw new Error('Rate limited by Resy API');
      }
    }

    const { text, status, statusText, ok } = result;

    if (looksLikeAuthFailure(status, text)) {
      throw new ResyAuthError(this.describeCredential().source);
    }

    if (!ok) {
      throw new ResyApiError(status, statusText, method, path, text);
    }

    return parseJsonBody<T>(text, method, path);
  }

  /**
   * Which mint path is CONFIGURED, for `resy_healthcheck` — a label, never a
   * token.
   *
   * Deliberately inspects the environment rather than calling `mintToken()`:
   * minting is side-effecting (path 2 performs a real password login, path 3
   * opens the fetchproxy bridge), and a healthcheck must not spend a login
   * attempt or a bridge round-trip just to say what is configured. The PROBE
   * exercises the real mint, so a path that is configured but broken still
   * surfaces — as a rejection rather than as "not configured", which is the
   * honest distinction.
   *
   * Mirrors `mintToken`'s path order exactly; if that order changes, this must
   * move with it or the healthcheck will name the wrong path.
   */
  describeCredential(): { source: string | null } {
    if (readVar('RESY_AUTH_TOKEN')) return { source: 'env token (RESY_AUTH_TOKEN)' };
    if (readVar('RESY_EMAIL') && readVar('RESY_PASSWORD')) return { source: 'password login' };
    if (!parseBoolEnv('RESY_DISABLE_FETCHPROXY')) return { source: 'fetchproxy' };
    return { source: null };
  }

  /**
   * Resolve a fresh auth token via one of three paths, in priority order:
   *
   * 1. `RESY_AUTH_TOKEN` env — direct override. Power users / CI that
   *    already have a token (e.g. extracted from a browser DevTools
   *    session) bypass everything else.
   * 2. `RESY_EMAIL` + `RESY_PASSWORD` env — the legacy password login
   *    flow (`POST /3/auth/password`). Unchanged from before fetchproxy.
   * 3. fetchproxy bootstrap — `POST /3/auth/refresh` through the user's
   *    signed-in resy.com browser tab. Opt-out via
   *    `RESY_DISABLE_FETCHPROXY=1` (or `true`/`yes`/`on`).
   *
   * If none of the three is configured/working, throws a guidance error
   * naming all three remediation paths. This is the TokenManager refresh
   * callback: it is invoked lazily on the first request and again on every
   * reactive 401/419/auth-500, re-running path selection each time (so an
   * env change between calls is picked up at retry time, and a
   * fetchproxy-minted session re-mints via fetchproxy).
   */
  private async mintToken(): Promise<string> {
    // Path 1: direct token override
    const envToken = readVar('RESY_AUTH_TOKEN');
    if (envToken) {
      return envToken;
    }

    // Path 2: legacy password login
    if (readVar('RESY_EMAIL') && readVar('RESY_PASSWORD')) {
      return this.loginWithPassword();
    }

    // Path 3: fetchproxy fallback. parseBoolEnv accepts 1/true/yes/on
    // (case-insensitively) like every sibling repo, not just the literal '1'.
    if (!parseBoolEnv('RESY_DISABLE_FETCHPROXY')) {
      try {
        return await mintTokenViaFetchproxy();
      } catch (e) {
        throw new Error(
          `Resy auth: fetchproxy fallback failed (${(e as Error).message}). ` +
            `Set RESY_EMAIL + RESY_PASSWORD, set RESY_AUTH_TOKEN directly, ` +
            `or install the ContextMint Bridge browser extension and sign into resy.com.`
        );
      }
    }

    throw new Error(
      'Resy auth: set RESY_EMAIL + RESY_PASSWORD, set RESY_AUTH_TOKEN, ' +
        'or install the ContextMint Bridge browser extension and sign into resy.com.'
    );
  }

  /**
   * Existing password-login flow, factored out so `mintToken()` can
   * select between paths. Returns the token.
   */
  private async loginWithPassword(): Promise<string> {
    const email = readVar('RESY_EMAIL')!;
    const password = readVar('RESY_PASSWORD')!;

    const { res: response, text } = await this.timedFetch('POST', '/3/auth/password', `${BASE_URL}/3/auth/password`, {
      method: 'POST',
      headers: {
        Authorization: `ResyAPI api_key="${this.apiKey}"`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...SPOOF_HEADERS,
      },
      body: new URLSearchParams({ email, password }).toString(),
    });

    // Login-failure bodies are untrusted upstream text and may echo
    // credentials/tokens — redact + truncate before they can reach a tool result.
    if (!response.ok) {
      throw new Error(
        `Resy login failed: ${response.status} ${response.statusText}: ${truncateErrorMessage(text)}`
      );
    }

    const data = (parseJsonBody<Record<string, any> | null>(text, 'POST', '/3/auth/password') ?? {});
    const token =
      (typeof data.token === 'string' && data.token) ||
      (typeof data?.id?.token === 'string' && data.id.token) ||
      (typeof data.auth_token === 'string' && data.auth_token) ||
      null;
    if (!token) {
      throw new Error(
        `Resy login response did not contain a token: ${truncateErrorMessage(text)}`
      );
    }
    return token;
  }
}

/**
 * A non-2xx, non-auth answer from api.resy.com. The message is unchanged from
 * the plain Error it replaces; what it adds is what the shared credential
 * healthcheck reads to tell a CDN/WAF refusal page from Resy itself
 * (chrischall/mcp-host#1015): the `status`, and a redacted, truncated
 * `bodyPreview` — an edge's block page names its vendor near the top, and
 * without the body a 403 from the edge is indistinguishable from one from Resy.
 */
export class ResyApiError extends Error {
  readonly status: number;
  readonly bodyPreview: string;

  constructor(status: number, statusText: string, method: string, path: string, body: string, note = '') {
    super(`Resy API error: ${status} ${statusText} for ${method} ${path}${note}`);
    this.name = 'ResyApiError';
    this.status = status;
    this.bodyPreview = truncateErrorMessage(body);
  }
}

/**
 * Resy refused the token. A CLASS rather than a bare Error because the
 * healthcheck has to tell this apart from a Resy-side outage, and it cannot do
 * that from a status: `request` rewrites 419 and auth-shaped 500s into a
 * synthetic 401 to drive TokenManager's one-shot replay, then throws with no
 * status at all. Matching the message instead would tie the arm to a sentence.
 *
 * The message is unchanged, so what a real tool reports is unchanged.
 */
export class ResyAuthError extends Error {
  /**
   * @param source the configured credential, as `describeCredential().source`
   *   names it, so the message points at the fix that applies — it used to
   *   blame RESY_EMAIL / RESY_PASSWORD whatever minted the token
   *   (fleet-audit#682).
   */
  constructor(source: string | null = 'password login') {
    super(`Resy session rejected — ${authRemedy(source)}`);
    this.name = 'ResyAuthError';
  }
}

function authRemedy(source: string | null): string {
  switch (source) {
    case 'env token (RESY_AUTH_TOKEN)':
      return 'RESY_AUTH_TOKEN was refused; replace it with a fresh token, or unset it to sign in another way';
    case 'fetchproxy':
      return 'the token from your resy.com browser tab was refused; sign in to resy.com again in that browser';
    default:
      return 'verify RESY_EMAIL / RESY_PASSWORD';
  }
}

/**
 * Narrow auth-failure classifier: a 401, a 419, or a 500 whose body names an
 * auth-scoped phrase. Deliberately does NOT match arbitrary mentions of "token"
 * (e.g. "book_token expired" is a stale booking token, not an auth failure).
 */
function looksLikeAuthFailure(status: number, text: string): boolean {
  return (
    status === 401 ||
    status === 419 ||
    (status === 500 && /\b(unauthorized|auth[_\s-]?token|authentication)\b/i.test(text))
  );
}
