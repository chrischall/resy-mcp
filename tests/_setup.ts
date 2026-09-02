// Suite-wide guard: no test may touch the developer's real token cache.
//
// `createTokenCache` resolves its path from MCP_DATA_DIR/HOME, so any test with
// RESY_EMAIL + RESY_PASSWORD set — or any that exercises the fetchproxy path —
// would read and write ~/.resy-mcp/token.json. That makes the suite
// non-hermetic, order-dependent, and able to leave a real file behind.
//
// Written before the cache module existed, on purpose: in three earlier repos in
// this rollout the guard was added AFTER the first run, and each time that run
// created a real file under $HOME.
//
// Two independent guards, deliberately belt-and-braces:
//   1. The cache is OFF by default, so the ordinary suite never constructs one.
//   2. The path is pinned into a temp dir anyway, so a test that turns the cache
//      ON to exercise it still cannot reach $HOME.
import { beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = mkdtempSync(join(tmpdir(), 'resy-test-cache-'));
const REAL_CACHE = join(homedir(), '.resy-mcp');

/**
 * Existence + write times of the real cache, or `null` when it is absent.
 * Sampled at module load (before any test runs) and again in `afterAll`, so the
 * tripwire can tell a leak the SUITE caused from a cache that was already
 * there — `npm run smoke` writes one legitimately, and a developer who runs
 * smoke before the suite must not be told a test leaked.
 */
function sampleRealCache(): { dir: number; token: number | null } | null {
  if (!existsSync(REAL_CACHE)) return null;
  const token = join(REAL_CACHE, 'token.json');
  return {
    dir: statSync(REAL_CACHE).mtimeMs,
    token: existsSync(token) ? statSync(token).mtimeMs : null,
  };
}

const CACHE_BEFORE = sampleRealCache();

beforeEach(() => {
  process.env.RESY_TOKEN_CACHE = 'false';
  process.env.RESY_TOKEN_FILE = join(CACHE_DIR, 'token.json');
});

afterAll(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });

  // The tripwire, and why the guards above are not enough on their own: both
  // work through process.env, and a client that reads an INJECTED env bypasses
  // them completely — the path resolver then falls back to os.homedir(), which
  // no environment variable can redirect. Fixing exactly that plumbing in
  // schoolpass-mcp is what created a real file under $HOME.
  //
  // So assert the outcome rather than the mechanism.
  const after = sampleRealCache();
  if (after === null) return;

  const hint =
    'The suite must never touch the real home directory — inject ' +
    'RESY_TOKEN_CACHE=false (or a temp RESY_TOKEN_FILE) into the env that ' +
    'test hands the client.';

  if (CACHE_BEFORE === null) {
    // The suite CREATED it. Remove it before throwing: detecting the leak and
    // leaving it behind pollutes the developer's home directory with the very
    // file the guard exists to prevent — and the next run would then fail on
    // the debris of the last one rather than on anything it did itself.
    rmSync(REAL_CACHE, { recursive: true, force: true });
    throw new Error(`A test wrote to ${REAL_CACHE}. ${hint}`);
  }

  if (after.dir !== CACHE_BEFORE.dir || after.token !== CACHE_BEFORE.token) {
    // It pre-existed and the suite wrote THROUGH it. Still a leak, so still a
    // failure — but do NOT delete: this is the developer's real cache, written
    // by `npm run smoke`, and destroying it is the harm the guard is meant to
    // prevent, not a cleanup.
    throw new Error(
      `A test wrote to the existing ${REAL_CACHE}. ${hint} ` +
        '(Left in place — it is a real cache, not test debris.)',
    );
  }

  // Unchanged and pre-existing: `npm run smoke` left it, no test went near it.
});
