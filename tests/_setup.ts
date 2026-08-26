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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = mkdtempSync(join(tmpdir(), 'resy-test-cache-'));

beforeEach(() => {
  process.env.RESY_TOKEN_CACHE = 'false';
  process.env.RESY_TOKEN_FILE = join(CACHE_DIR, 'token.json');
});

afterAll(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
});
