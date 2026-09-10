import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolveStateFile } from '@chrischall/mcp-utils/session';

/**
 * Cache for Resy's web API key — the `authorization: ResyAPI api_key="…"`
 * header the site sends on every `api.resy.com` call.
 *
 * Why this exists (chrischall/fetchproxy#324): `/3/auth/refresh` is answered
 * **419 Unauthorized** without that header, and Resy's error path omits
 * `Access-Control-Allow-Origin`, so the browser discards the response and the
 * caller sees only `TypeError: Failed to fetch` — no status, no body. Five
 * rounds of that issue were spent on WAFs and CORS before the missing header
 * turned out to be the whole story.
 *
 * Why it is cached SEPARATELY from the token, rather than beside it: the two
 * have opposite lifetimes. A token is a session credential that expires; the
 * key is a long-lived constant shipped in the site's public bundle, identical
 * for every visitor. That difference is what makes the fallback work
 * unattended — capture needs the page to make a request while we listen, and a
 * cold start against an IDLE tab makes none. Capturing the key once, whenever
 * the tab happens to be busy, buys every later cold start a working
 * `/3/auth/refresh` with no capture at all (chrischall/resy-mcp#166).
 *
 * Deliberately NOT treated as a secret: it identifies the web client, not the
 * user, and is readable by anyone who loads resy.com. It is cached for
 * availability, not confidentiality — which is also why a read failure is
 * never fatal.
 */
export function apiKeyCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveStateFile({
    env,
    envVar: 'RESY_API_KEY_FILE',
    subdir: '.resy-mcp',
    fileName: 'api-key.json',
  });
}

interface CachedApiKey {
  apiKey: string;
  capturedAt: number;
}

/**
 * Shortest plausible `ResyAPI api_key="…"` header.
 *
 * Guards against caching an empty or echoed value, which would then be sent on
 * every refresh and produce the same invisible 419 this cache exists to stop —
 * except permanently, and without the timeout that at least names itself.
 */
const MIN_KEY_LENGTH = 20;

function isCached(raw: unknown): raw is CachedApiKey {
  if (raw === null || typeof raw !== 'object') return false;
  const c = raw as Partial<CachedApiKey>;
  return (
    typeof c.apiKey === 'string' &&
    c.apiKey.length >= MIN_KEY_LENGTH &&
    typeof c.capturedAt === 'number'
  );
}

/** The cached key, or `null` when there is nothing usable. Never throws. */
export function readCachedApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(apiKeyCachePath(env), 'utf8'));
    return isCached(raw) ? raw.apiKey : null;
  } catch {
    // No file, unreadable, or malformed — all mean "capture it again", which
    // is a slower path and not a failure.
    return null;
  }
}

/**
 * Cache a captured key. Never throws: failing to WRITE it costs the next cold
 * start a capture, while throwing would fail a mint that has already succeeded.
 */
export function writeCachedApiKey(
  apiKey: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (typeof apiKey !== 'string' || apiKey.length < MIN_KEY_LENGTH) return;
  try {
    const path = apiKeyCachePath(env);
    mkdirSync(dirname(path), { recursive: true });
    const record: CachedApiKey = { apiKey, capturedAt: Date.now() };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  } catch {
    /* best effort by design — see the docblock */
  }
}
