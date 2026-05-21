import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mintTokenViaFetchproxy } from './auth-fetchproxy.js';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // quiet: true suppresses dotenv v17's stdout telemetry banner, which
  // Claude Desktop would otherwise try to parse as a JSON-RPC message
  // and reject with "Invalid JSON-RPC message".
  config({ path: join(__dirname, '..', '.env'), override: false, quiet: true });
} catch {
  // mcpb bundle won't have dotenv — rely on process.env set by mcp_config.env
}

/**
 * Read an env var, trim whitespace, and treat as unset if blank or if the value
 * looks like an unsubstituted shell placeholder (e.g. `${FOO}`) — defends
 * against MCP hosts that pass .mcp.json env blocks through unexpanded.
 */
function readVar(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'undefined' || trimmed === 'null') return undefined;
  if (/^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

const BASE_URL = 'https://api.resy.com';
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

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
  private token: string | null = null;

  constructor() {
    this.apiKey = readVar('RESY_API_KEY') || DEFAULT_API_KEY;
  }

  async request<T>(method: string, path: string, body?: ResyBody): Promise<T> {
    await this.ensureAuthenticated();
    return this.doRequest<T>(method, path, body, false);
  }

  private async doRequest<T>(
    method: string,
    path: string,
    body: ResyBody,
    isRetry: boolean
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams;
    const headers: Record<string, string> = {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      'x-resy-auth-token': this.token!,
      'x-resy-universal-auth': this.token!,
      ...SPOOF_HEADERS,
    };
    if (body !== undefined) {
      headers['Content-Type'] = isForm
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: isForm ? (body as URLSearchParams).toString() : JSON.stringify(body) }
        : {}),
    });

    const text = await response.text();

    // Narrow: match only auth-scoped phrases, not any mention of "token"
    // (Resy occasionally says things like "book_token expired" which is a
    // different failure and shouldn't trigger a re-login).
    const looksLikeAuthFailure =
      response.status === 401 ||
      response.status === 419 ||
      (response.status === 500 && /\b(unauthorized|auth[_\s-]?token|authentication)\b/i.test(text));

    if (looksLikeAuthFailure && !isRetry) {
      this.token = null;
      await this.refreshToken();
      return this.doRequest<T>(method, path, body, true);
    }
    if (looksLikeAuthFailure) {
      throw new Error(
        'Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD'
      );
    }

    if (response.status === 429 && !isRetry) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      return this.doRequest<T>(method, path, body, true);
    }
    if (response.status === 429) {
      throw new Error('Rate limited by Resy API');
    }

    if (!response.ok) {
      throw new Error(
        `Resy API error: ${response.status} ${response.statusText} for ${method} ${path}`
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) return;
    await this.refreshToken();
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
   *    `RESY_DISABLE_FETCHPROXY=1`.
   *
   * If none of the three is configured/working, throws a guidance error
   * naming all three remediation paths.
   */
  private async refreshToken(): Promise<void> {
    // Path 1: direct token override
    const envToken = readVar('RESY_AUTH_TOKEN');
    if (envToken) {
      this.token = envToken;
      return;
    }

    // Path 2: legacy password login
    if (readVar('RESY_EMAIL') && readVar('RESY_PASSWORD')) {
      this.token = await this.loginWithPassword();
      return;
    }

    // Path 3: fetchproxy fallback
    if (readVar('RESY_DISABLE_FETCHPROXY') !== '1') {
      try {
        this.token = await mintTokenViaFetchproxy();
        return;
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
   * Existing password-login flow, factored out so `refreshToken()` can
   * select between paths. Returns the token; the caller assigns it to
   * `this.token`.
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
    if (!response.ok) {
      throw new Error(
        `Resy login failed: ${response.status} ${response.statusText}: ${text.slice(0, 200)}`
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
        `Resy login response did not contain a token: ${text.slice(0, 200)}`
      );
    }
    return token;
  }
}
