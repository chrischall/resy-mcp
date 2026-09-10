import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { readCachedApiKey, writeCachedApiKey } from '../src/api-key-cache.js';

/**
 * The key cache is what makes the `/3/auth/refresh` fallback work UNATTENDED
 * (chrischall/resy-mcp#166). Capture resolves on the next request the page
 * makes, so a cold start against an idle tab captures nothing — but the api key
 * is a long-lived constant, so one captured earlier is still good.
 */
const freshEnv = () => ({
  RESY_API_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'resy-kc-')), 'api-key.json'),
}) as NodeJS.ProcessEnv;

const KEY = 'ResyAPI api_key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';

describe('api key cache', () => {
  it('round-trips a captured key', () => {
    const env = freshEnv();
    writeCachedApiKey(KEY, env);
    expect(readCachedApiKey(env)).toBe(KEY);
  });

  it('answers null when nothing is cached', () => {
    expect(readCachedApiKey(freshEnv())).toBeNull();
  });

  // Caching an empty or echoed value would send a header that LOOKS set and
  // still 419s — the same invisible failure, made permanent.
  it('refuses to store an implausibly short value', () => {
    const env = freshEnv();
    for (const bad of ['', 'short', 'ResyAPI api_key=""']) {
      writeCachedApiKey(bad, env);
      expect(readCachedApiKey(env), `stored ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  // Distinguishes the WRITE guard from the read guard: a refused value must
  // not reach the file at all, or the two guards are one guard with a spare.
  it('writes no file at all for a short value', () => {
    const env = freshEnv();
    writeCachedApiKey('short', env);
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
  it('never throws when the path is unwritable', () => {
    expect(() =>
      writeCachedApiKey(KEY, { RESY_API_KEY_FILE: '/proc/nope/api-key.json' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

/**
 * Shape, not length. A test banked the TOKEN fixture as an api key because a
 * length guard let it through; in production the same confusion is one
 * mis-declared capture away, and the result is a permanent invisible 419.
 */
describe('api key shape', () => {
  it('refuses a value that is not a ResyAPI authorization header', () => {
    const env = freshEnv();
    for (const bad of [
      'captured-tk-aaaaaaaaaaaaaaaaaaaaaa', // a token, long enough to pass a length check
      'Bearer aaaaaaaaaaaaaaaaaaaaaaaa',
      'ResyAPI api_key=', // no quoted value
      'ResyAPI api_key=""', // empty
    ]) {
      writeCachedApiKey(bad, env);
      expect(readCachedApiKey(env), `stored ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('accepts a well-formed header', () => {
    const env = freshEnv();
    writeCachedApiKey('ResyAPI api_key="abc123"', env);
    expect(readCachedApiKey(env)).toBe('ResyAPI api_key="abc123"');
  });

  // Belt and braces are two guards, not one: a file written by an older build
  // must not be believed just because it is on disk.
  it('refuses a badly shaped value already on disk', () => {
    const env = freshEnv();
    writeFileSync(
      env.RESY_API_KEY_FILE as string,
      JSON.stringify({ apiKey: 'captured-tk-aaaaaaaaaaaaaaaaaaaaaa', capturedAt: Date.now() }),
    );
    expect(readCachedApiKey(env)).toBeNull();
  });
});
