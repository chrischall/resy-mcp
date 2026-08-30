import { dirname, join } from 'path';
import { createTokenCache, reportCacheWriteFailure } from './token-cache.js';
import { fileURLToPath } from 'url';
import { readEnvVar, loadDotenvSafely, parseBoolEnv, truncateErrorMessage } from '@chrischall/mcp-utils';
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
// Resy's PUBLIC web-app API key — the same value baked into resy.com's browser
// JavaScript and visible to anyone who opens DevTools on the site. It is not a
// secret: every unauthenticated request to api.resy.com carries it. We only use
// it as the default when RESY_API_KEY is unset, and document overriding it in
// the README in case Resy ever rotates it. (Audited: not a committed secret.)
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

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

export type ResyBody =
  | undefined
  | Record<string, unknown>
  | URLSearchParams;

export class ResyClient {
  private readonly apiKey: string;
  private readonly tokens: TokenManager;

  constructor() {
    this.apiKey = readVar('RESY_API_KEY') || DEFAULT_API_KEY;
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
    let captured: { text: string; status: number; statusText: string; ok: boolean } | null = null;
    await this.tokens.withAuth(async (token) => {
      const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(token) });
      const text = await res.text();
      captured = { text, status: res.status, statusText: res.statusText, ok: res.ok };
      // Narrow: match only auth-scoped phrases, not any mention of "token"
      // (Resy occasionally says things like "book_token expired" which is a
      // different failure and shouldn't trigger a re-login).
      if (looksLikeAuthFailure(res.status, text) && res.status !== 401) {
        // Re-wrap a 419 / auth-500 as a 401 so TokenManager.withAuth clears +
        // re-mints + replays once. The real status/body stay in `captured`.
        return new Response(null, { status: 401, statusText: res.statusText });
      }
      return res;
    });

    const { text, status, statusText, ok } = captured!;

    if (looksLikeAuthFailure(status, text)) {
      throw new Error(
        'Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD'
      );
    }

    if (status === 429) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      return this.requestRetry<T>(method, path, init, buildHeaders);
    }

    if (!ok) {
      throw new Error(
        `Resy API error: ${status} ${statusText} for ${method} ${path}`
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  /**
   * The 429 backoff retry: a single direct re-issue of the request under the
   * current token (no second token re-mint — 429 is rate-limiting, not auth).
   * A persisting 429 surfaces as a rate-limit error; any other status flows
   * through the normal success/error handling.
   */
  private async requestRetry<T>(
    method: string,
    path: string,
    init: Omit<RequestInit, 'headers'>,
    buildHeaders: (token: string) => Record<string, string>
  ): Promise<T> {
    const token = await this.tokens.getAccessToken();
    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(token) });
    const text = await res.text();

    if (res.status === 429) {
      throw new Error('Rate limited by Resy API');
    }
    if (looksLikeAuthFailure(res.status, text)) {
      throw new Error('Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD');
    }
    if (!res.ok) {
      throw new Error(
        `Resy API error: ${res.status} ${res.statusText} for ${method} ${path}`
      );
    }
    return (text ? JSON.parse(text) : null) as T;
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
            `or install the fetchproxy extension and sign into resy.com.`
        );
      }
    }

    throw new Error(
      'Resy auth: set RESY_EMAIL + RESY_PASSWORD, set RESY_AUTH_TOKEN, ' +
        'or install the fetchproxy extension and sign into resy.com.'
    );
  }

  /**
   * Existing password-login flow, factored out so `mintToken()` can
   * select between paths. Returns the token.
   */
  private async loginWithPassword(): Promise<string> {
    const email = readVar('RESY_EMAIL')!;
    const password = readVar('RESY_PASSWORD')!;

    const response = await fetch(`${BASE_URL}/3/auth/password`, {
      method: 'POST',
      headers: {
        Authorization: `ResyAPI api_key="${this.apiKey}"`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...SPOOF_HEADERS,
      },
      body: new URLSearchParams({ email, password }).toString(),
    });

    const text = await response.text();
    // Login-failure bodies are untrusted upstream text and may echo
    // credentials/tokens — redact + truncate before they can reach a tool result.
    if (!response.ok) {
      throw new Error(
        `Resy login failed: ${response.status} ${response.statusText}: ${truncateErrorMessage(text)}`
      );
    }

    const data = text ? JSON.parse(text) : {};
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
