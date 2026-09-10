import { readEnvVar } from '@chrischall/mcp-utils';

import { readCachedApiKey } from './api-key-cache.js';

/**
 * Resy's PUBLIC web-app API key — the same value baked into resy.com's browser
 * JavaScript and visible to anyone who opens DevTools on the site. It is not a
 * secret: every unauthenticated request to api.resy.com carries it. We only use
 * it as the default when RESY_API_KEY is unset, and document overriding it in
 * the README in case Resy ever rotates it. (Audited: not a committed secret.)
 */
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

/**
 * The api key every api.resy.com call must carry, in precedence order.
 *
 * 1. `RESY_API_KEY` — an operator's explicit override always wins.
 * 2. The last key CAPTURED from the live site (`api-key-cache.ts`).
 * 3. `DEFAULT_API_KEY` — the value compiled in here.
 *
 * The captured layer exists because the constant can go stale and the failure
 * is total: if Resy rotates the key, every call 419s until a human notices and
 * sets an env var, and the 419 is invisible in a browser context because Resy's
 * error path omits `Access-Control-Allow-Origin` (chrischall/fetchproxy#324).
 * The comment on `DEFAULT_API_KEY` has always said "in case Resy ever rotates
 * it" — capture is that sentence made automatic instead of manual.
 *
 * It sits BELOW the env override on purpose: an operator pinning a key is
 * making a deliberate choice and a snapshot of the site must not silently beat
 * it.
 *
 * This lives in its OWN module rather than in `client.ts` because `client.ts`
 * imports `auth-fetchproxy.ts`, and the bootstrap needs the same value — so
 * reaching back for it would be a cycle. A shared leaf is the shape that
 * works, not merely the tidier one.
 */
export function resolveApiKey(): string {
  return readEnvVar('RESY_API_KEY') || readCachedApiKey() || DEFAULT_API_KEY;
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
