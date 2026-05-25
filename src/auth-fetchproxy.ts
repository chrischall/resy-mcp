/**
 * Pattern-B fetchproxy auth bootstrap.
 *
 * Resy's session lives in HttpOnly cookies. The page's JS calls
 * `POST https://api.resy.com/3/auth/refresh`, the cookies authenticate
 * the call, and the response body returns a short single-field
 * `{ token: "..." }` that the page holds in JS memory for subsequent
 * authenticated calls.
 *
 * We replicate that single call via the fetchproxy bridge — the browser
 * extension auto-attaches the HttpOnly cookies, the response body comes
 * back to us with the token, and from that point on the MCP holds the
 * token and makes direct Node `fetch` calls. fetchproxy is invoked once
 * per session bootstrap, never in the hot path.
 *
 * This is "Pattern B": one bootstrap call via fetchproxy, then direct
 * fetch. It does NOT need `@fetchproxy/bootstrap` (that helper is
 * shaped for read_* verbs — cookies / localStorage / headers).
 */
import { FetchproxyServer } from '@fetchproxy/server';

// Kept in sync with package.json by release-please via the
// `x-release-please-version` marker on PACKAGE_VERSION below
// (registered in release-please-config.json `extra-files`).
const PACKAGE_NAME = 'resy-mcp';
const PACKAGE_VERSION = '0.2.2'; // x-release-please-version

interface RefreshResponse {
  token?: unknown;
}

/**
 * Bootstrap a Resy auth token by calling `/3/auth/refresh` through the
 * user's signed-in resy.com browser tab via fetchproxy.
 *
 * Returns the fresh token string on success. Throws an `Error` if the
 * bridge could not reach a signed-in tab, the response did not contain
 * a `token` field, or any other failure.
 */
export async function mintTokenViaFetchproxy(): Promise<string> {
  const fp = new FetchproxyServer({
    serverName: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    domains: ['resy.com'],
  });

  try {
    await fp.listen();
    const response = await fp.postJson<RefreshResponse>(
      '/3/auth/refresh',
      {},
      { subdomain: 'api' }
    );
    if (
      !response ||
      typeof response.token !== 'string' ||
      response.token.length === 0
    ) {
      throw new Error('fetchproxy: /3/auth/refresh returned no token');
    }
    return response.token;
  } finally {
    try {
      await fp.close();
    } catch {
      /* swallow shutdown errors — the token (or the original failure) is what matters */
    }
  }
}
