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
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = mkdtempSync(join(tmpdir(), 'resy-test-cache-'));

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
  const leaked = join(homedir(), '.resy-mcp');
  if (existsSync(leaked)) {
    throw new Error(
      `A test wrote to ${leaked}. The suite must never touch the real home ` +
        'directory — inject RESY_TOKEN_CACHE=false (or a temp RESY_TOKEN_FILE) ' +
        'into the env that test hands the client.',
    );
  }
});
