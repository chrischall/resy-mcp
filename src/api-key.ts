import { readEnvVar } from '@chrischall/mcp-utils';

/**
 * Resy's PUBLIC web-app API key — the same value baked into resy.com's browser
 * JavaScript and visible to anyone who opens DevTools on the site. It is not a
 * secret: every unauthenticated request to api.resy.com carries it. We only use
 * it as the default when RESY_API_KEY is unset, and document overriding it in
 * the README in case Resy ever rotates it. (Audited: not a committed secret.)
 */
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

/**
 * The api key every api.resy.com call must carry.
 *
 * It lives in its OWN module rather than in `client.ts` because `client.ts`
 * imports `auth-fetchproxy.ts`, and the bootstrap needs the same value — so
 * reaching back for it would be a cycle. A shared leaf is the shape that
 * works, not merely the tidier one.
 */
export function resolveApiKey(): string {
  return readEnvVar('RESY_API_KEY') || DEFAULT_API_KEY;
}

/**
 * The `Authorization` header value, built once so the two call sites cannot
 * drift on quoting.
 *
 * Why the bootstrap needs it at all (chrischall/fetchproxy#324):
 * `/3/auth/refresh` is answered **419 Unauthorized** without this header, and
 * Resy's error path omits `Access-Control-Allow-Origin` — so the browser
 * discards the response and the caller sees only `TypeError: Failed to fetch`,
 * with no status and no body. That is why the fallback had never once worked,
 * and why five rounds of that issue went to WAFs and CORS first.
 */
export function apiKeyAuthorization(): string {
  return `ResyAPI api_key="${resolveApiKey()}"`;
}
