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
 *
 * As of @fetchproxy/server 0.8.0, the convenience verbs (`postJson`
 * included) get a 30-second per-request timeout and a one-shot
 * lazy-revive retry on Chrome MV3 service-worker eviction (2000ms
 * default) for free — no local wrapper needed. `postJson` throws
 * typed `FetchproxyBridgeDownError` / `FetchproxyTimeoutError` on
 * bridge failures; the catch in `client.ts` surfaces them as a
 * guidance error.
 *
 * The bridge is constructed via `@chrischall/mcp-utils/fetchproxy`'s
 * `createFetchproxyTransport` (which needs `@fetchproxy/server` >= 0.11):
 * it wraps `new FetchproxyServer({...})` with the fleet-standard
 * `start()`/`close()` lifecycle and exposes the raw `.server` so we can
 * issue the single `postJson` bootstrap call. `start()` is `listen()`;
 * `close()` is `close()`. No behavior change versus the prior direct
 * construction — just the shared lifecycle wrapper.
 */
import { createBootstrapOpts, createFetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { readPortEnv } from '@chrischall/mcp-utils';

// Kept in sync with package.json by release-please via the
// `x-release-please-version` marker on PACKAGE_VERSION below
// (registered in release-please-config.json `extra-files`).
const PACKAGE_NAME = 'resy-mcp';
const PACKAGE_VERSION = '0.10.0'; // x-release-please-version

/**
 * The fetchproxy concentrator port.
 *
 * ONE port for the whole fleet: the Transporter extension dials it and the
 * servers host/peer-elect on it, so a "unique" per-MCP default would simply not
 * be found. `RESY_WS_PORT` overrides it for local development, test isolation —
 * and, the reason it exists at all, for a HOSTED bridged registration, where
 * mcp-host names this variable in the registration's `bridgePortEnv` and places
 * the child's port in it. Without a variable to read, `bridgePortEnv` would name
 * something nothing consumed: the host would believe it had placed the bridge
 * while the child listened elsewhere.
 *
 * `readPortEnv` (not `Number(...)`) because the value arrives from a host
 * template: an unsubstituted `${RESY_WS_PORT}` or any junk falls back to the
 * default instead of handing `NaN` to the server.
 */
const DEFAULT_WS_PORT = 37_149;
export function getWsPort(): number {
  return readPortEnv('RESY_WS_PORT', DEFAULT_WS_PORT);
}

/**
 * Where the token is READ from, rather than asked for.
 *
 * resy.com's own JS calls api.resy.com constantly and sends
 * `x-resy-auth-token` with every one. Snapshotting that header off a request
 * the page already made needs no request of our own — which matters, because
 * the request of our own is the thing that does not work: `/3/auth/refresh` is
 * CROSS-ORIGIN to the tab, and the isolated world cannot make those. Measured
 * against the live bridge, a same-origin GET to resy.com returns 200 while
 * every api.resy.com call fails with "Failed to fetch".
 *
 * `createBootstrapOpts` derives the `capture_request_header` capability from
 * this declaration, so the verb cannot be declared without being unlocked.
 * Widening the capability changes the requested scope, so the extension asks
 * the user to approve the pairing again.
 */
const CAPTURE_DECL = {
  host: 'api.resy.com',
  path: '/*',
  headerName: 'x-resy-auth-token',
} as const;

/** How long to wait for the page to make a request we can read. */
const CAPTURE_TIMEOUT_MS = 15_000;

/** Shortest plausible Resy token; guards against an empty/echoed header. */
const MIN_TOKEN_LENGTH = 20;

/**
 * The tab that relays the bootstrap call. resy.com is canonical — www.resy.com
 * 301s to it — and must stay inside `domains` below.
 */
const BRIDGE_TAB_URL = 'https://resy.com/';

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
  const transport = createFetchproxyTransport({
    ...createBootstrapOpts({
      domains: 'resy.com',
      bootstrap: { captureHeaders: [{ ...CAPTURE_DECL }] },
    }),
    // `createBootstrapOpts` derives `capabilities` from the DECLARATIONS
    // alone, and 'fetch' is not one of them — so taking its output verbatim
    // declares `capture_request_header` and silently drops the fetch verb the
    // fallback below needs. Observed live as:
    //   capability "fetch" not granted (declared: [capture_request_header])
    // Restore it explicitly. (@chrischall/mcp-utils 0.19.3.)
    capabilities: ['fetch', 'capture_request_header'],
    port: getWsPort(),
    serverName: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    // keepAliveIntervalMs is no longer set here: @fetchproxy/server 0.10.0
    // defaults it to 25_000 — the same cadence we relied on to keep the SW
    // resident through the token-refresh window (fetchproxy#72).
  });

  try {
    await transport.start();

    // 1. READ a token off the page's own traffic. The path that works today:
    //    no request of ours crosses an origin, so the isolated world's
    //    cross-origin block does not apply.
    let captureError: string;
    try {
      const captured = await transport.server.captureRequestHeader({
        ...CAPTURE_DECL,
        timeoutMs: CAPTURE_TIMEOUT_MS,
      });
      if (typeof captured === 'string' && captured.length >= MIN_TOKEN_LENGTH) {
        return captured;
      }
      // A present-but-implausible header is a capture that technically
      // succeeded and is not a token — say so rather than reporting a timeout.
      captureError =
        `${CAPTURE_DECL.headerName} was present on ${CAPTURE_DECL.host} but too short ` +
        `to be a token (${typeof captured === 'string' ? captured.length : 0} chars)`;
    } catch (e) {
      captureError = (e as Error).message;
    }

    // 2. ASK for one. Cross-origin, so this needs the MAIN world
    //    (`fetch_in_page`, fetchproxy#267) to succeed from a browser tab; it
    //    stays as the fallback because it is the path that does not depend on
    //    the page happening to make a request while we listen.
    let response: RefreshResponse;
    try {
      response = await transport.server.postJson<RefreshResponse>(
      '/3/auth/refresh',
      {},
      {
        subdomain: 'api',
        // The REQUEST goes to api.resy.com; the TAB that performs it must be
        // resy.com. Without this, the transport derives the relay tab from the
        // request's own host and looks for a tab on api.resy.com — a host that
        // serves no app and so never has one, failing every mint with "no tab
        // matching https://api.resy.com/" however signed-in the user was.
        //
        // The signed-in resy.com tab issues this exact call as part of the
        // site's own JS, and its HttpOnly cookies are what authenticate it.
        // resy.com is the canonical host (www.resy.com 301s to it) and is
        // inside the declared `domains`, so this widens which tab relays,
        // never which origins are reachable.
        viaTab: BRIDGE_TAB_URL,
      }
      );
    } catch (e) {
      // BOTH failures, or the message names only the fallback and reads as if
      // capture was never tried — the reverse of what actually happened.
      throw new Error(
        `fetchproxy: header capture failed (${captureError}) and ` +
          `/3/auth/refresh failed (${(e as Error).message})`,
      );
    }
    if (
      !response ||
      typeof response.token !== 'string' ||
      response.token.length === 0
    ) {
      throw new Error(
        `fetchproxy: header capture failed (${captureError}) and ` +
          '/3/auth/refresh returned no token',
      );
    }
    return response.token;
  } finally {
    try {
      await transport.close();
    } catch {
      /* swallow shutdown errors — the token (or the original failure) is what matters */
    }
  }
}
