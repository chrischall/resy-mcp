import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
    this.apiKey = process.env.RESY_API_KEY || DEFAULT_API_KEY;
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
      await this.login();
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
    await this.login();
  }

  private async login(): Promise<void> {
    const email = process.env.RESY_EMAIL;
    const password = process.env.RESY_PASSWORD;
    if (!email || !password) {
      const missing = [!email && 'RESY_EMAIL', !password && 'RESY_PASSWORD']
        .filter(Boolean)
        .join(' and ');
      throw new Error(`${missing} must be set`);
    }

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
    this.token = token;
  }
}
