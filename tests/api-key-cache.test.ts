import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { readCachedApiKey, writeCapturedAuthorization } from '../src/api-key-cache.js';

/**
 * The key cache is what makes the `/3/auth/refresh` fallback work UNATTENDED
 * (chrischall/resy-mcp#166). Capture resolves on the next request the page
 * makes, so a cold start against an idle tab captures nothing — but the api key
 * is a long-lived constant, so one captured earlier is still good.
 */
const freshEnv = () => ({
  RESY_API_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'resy-kc-')), 'api-key.json'),
}) as NodeJS.ProcessEnv;

const HEADER = 'ResyAPI api_key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
const BARE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('api key cache', () => {
  // The contract: a HEADER goes in, the BARE key comes out. Storing the header
  // is what produced `ResyAPI api_key="ResyAPI api_key="…""` on every call.
  it('takes a header and returns the bare key', () => {
    const env = freshEnv();
    writeCapturedAuthorization(HEADER, env);
    expect(readCachedApiKey(env)).toBe(BARE);
  });

  it('answers null when nothing is cached', () => {
    expect(readCachedApiKey(freshEnv())).toBeNull();
  });

  // Caching an empty or echoed value would send a header that LOOKS set and
  // still 419s — the same invisible failure, made permanent.

  // Distinguishes the WRITE guard from the read guard: a refused value must
  // not reach the file at all, or the two guards are one guard with a spare.
  it('writes no file at all for a value it will not store', () => {
    const env = freshEnv();
    writeCapturedAuthorization('not-a-header', env);
    expect(existsSync(env.RESY_API_KEY_FILE as string)).toBe(false);
  });

  it('treats a malformed file as absent rather than throwing', () => {
    const env = freshEnv();
    writeFileSync(env.RESY_API_KEY_FILE as string, 'not json');
    expect(readCachedApiKey(env)).toBeNull();
  });

  it('treats a well-formed file with a junk record as absent', () => {
    const env = freshEnv();
    writeFileSync(env.RESY_API_KEY_FILE as string, JSON.stringify({ apiKey: 42 }));
    expect(readCachedApiKey(env)).toBeNull();
  });

  // A write failure costs the next cold start a capture; throwing would fail a
  // mint that has already succeeded.
  //
  // The unwritable path is a file with a child path under it, which is ENOTDIR
  // on every platform and fails instantly. It used to be `/proc/nope/...`,
  // which is only unwritable on Linux — and on Linux it did not fail fast, it
  // WEDGED: CI ran every other test file in five seconds and then sat until a
  // timeout killed it four minutes later, with no summary and no coverage
  // report to say why. A test fixture that behaves differently per platform is
  // one the developer cannot reproduce.
  it('never throws when the path is unwritable', () => {
    const parent = join(mkdtempSync(join(tmpdir(), 'resy-ak-')), 'not-a-dir');
    writeFileSync(parent, 'x');
    expect(() =>
      writeCapturedAuthorization(HEADER, {
        RESY_API_KEY_FILE: join(parent, 'api-key.json'),
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

describe('api key shape', () => {
  it('refuses anything that is not a ResyAPI authorization header', () => {
    const env = freshEnv();
    for (const bad of [
      'captured-tk-aaaaaaaaaaaaaaaaaaaaaa', // a token — long, and not a header
      'Bearer aaaaaaaaaaaaaaaaaaaaaaaa',
      'ResyAPI api_key=',
      'ResyAPI api_key=""',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // a BARE key: right value, wrong shape in
    ]) {
      writeCapturedAuthorization(bad, env);
      expect(readCachedApiKey(env), `stored ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  // Belt and braces are two guards, not one: a file written by an older build
  // stored the full header, and must not be believed now.
  it('refuses a header-shaped value already on disk', () => {
    const env = freshEnv();
    writeFileSync(
      env.RESY_API_KEY_FILE as string,
      JSON.stringify({ apiKey: HEADER, capturedAt: Date.now() }),
    );
    expect(readCachedApiKey(env)).toBeNull();
  });
});
