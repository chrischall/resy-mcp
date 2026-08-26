import {
  createFileStatePersistence,
  resolveStateFile,
  type BearerTokens,
  type SyncStatePersistence,
} from '@chrischall/mcp-utils/session';
import { readEnvVar, parseBoolEnv } from '@chrischall/mcp-utils';

/** Where the minted Resy auth token is cached between runs. */
export function tokenCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveStateFile({
    env,
    envVar: 'RESY_TOKEN_FILE',
    subdir: '.resy-mcp',
    fileName: 'token.json',
  });
}

/**
 * Guard the stored record.
 *
 * `expiresAt` must be a real number here, which is the reason `NEVER_EXPIRES` in
 * `client.ts` is a far-future constant rather than `Infinity`: JSON has no
 * infinity literal, so `JSON.stringify` writes `null` and the value comes back a
 * non-number. A cache holding that sentinel would be written on every mint and
 * rejected on every load — doing nothing, silently, while every "it saves" test
 * still passed.
 */
function isToken(raw: unknown): raw is BearerTokens {
  if (raw === null || typeof raw !== 'object') return false;
  const t = raw as Partial<BearerTokens>;
  return (
    typeof t.accessToken === 'string' &&
    t.accessToken !== '' &&
    typeof t.expiresAt === 'number' &&
    (t.refreshToken === undefined || typeof t.refreshToken === 'string')
  );
}

/**
 * What a cached token is bound to, or `null` when this configuration has
 * nothing worth caching.
 *
 * Which of Resy's three auth paths is in play decides, because what a mint
 * COSTS differs:
 *
 *  - `RESY_AUTH_TOKEN` — the token IS the environment variable. There is no
 *    mint to skip, so caching would only copy a credential onto disk.
 *  - `RESY_EMAIL`/`RESY_PASSWORD` — a real password login. Worth caching.
 *  - fetchproxy — the token is lifted from a signed-in browser tab. Worth
 *    caching most of all: a cached token lets a cold start proceed with no
 *    browser present at all, which is the difference between working and not on
 *    a host that has none.
 *
 * The mode is part of the binding, so switching between them discards the old
 * record rather than reusing a token minted a different way.
 */
function bindingFor(env: NodeJS.ProcessEnv): string | null {
  if (readEnvVar('RESY_AUTH_TOKEN', { env }) !== undefined) return null;
  const email = readEnvVar('RESY_EMAIL', { env });
  const password = readEnvVar('RESY_PASSWORD', { env });
  if (email !== undefined && password !== undefined) {
    return ['password', email.trim().toLowerCase(), password].join('\u0000');
  }
  if (!parseBoolEnv('RESY_DISABLE_FETCHPROXY', { env })) return 'fetchproxy';
  return null;
}

/**
 * The token cache, or `null` when it is off or the configuration has nothing
 * worth caching (see {@link bindingFor}).
 *
 * Only a salted digest of the credentials is written, never the values.
 */
export function createTokenCache(
  env: NodeJS.ProcessEnv = process.env,
): SyncStatePersistence<BearerTokens> | null {
  if (!parseBoolEnv('RESY_TOKEN_CACHE', { env, default: true })) return null;
  const boundTo = bindingFor(env);
  if (boundTo === null) return null;

  return createFileStatePersistence<BearerTokens>({
    filePath: tokenCachePath(env),
    boundTo,
    validate: (raw) => (isToken(raw) ? raw : null),
  });
}

/**
 * Report a cache write that failed. Not fatal: the token is re-mintable from
 * whatever path minted it, so a lost write costs the next start a mint rather
 * than access. Worth saying, though — a read-only data dir otherwise looks
 * exactly like a server that never caches.
 *
 * stderr only; stdout is the JSON-RPC channel.
 */
export function reportCacheWriteFailure(err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(
    `[resy-mcp] could not cache the auth token (${detail}); continuing without the ` +
      'cache — every restart will mint a new token until this is fixed.',
  );
}
