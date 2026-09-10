import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { resolveApiKey } from '../src/api-key.js';

/**
 * Precedence: explicit override > captured-from-the-live-site > compiled-in.
 *
 * The captured layer exists because the constant goes stale the day Resy
 * rotates the key, and the failure is total AND silent: every call 419s, and
 * Resy's error path omits `Access-Control-Allow-Origin`, so in a browser
 * context it surfaces as an unexplained `Failed to fetch`
 * (chrischall/fetchproxy#324). The compiled-in comment has always said "in
 * case Resy ever rotates it" — this makes that automatic rather than manual.
 */
const COMPILED_IN = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const CAPTURED = 'ResyAPI api_key="captured-aaaaaaaaaaaaaaaa"';

const priorKey = process.env.RESY_API_KEY;
const priorFile = process.env.RESY_API_KEY_FILE;

function cacheHolding(value: string): string {
  const f = join(mkdtempSync(join(tmpdir(), 'resy-ak-')), 'api-key.json');
  writeFileSync(f, JSON.stringify({ apiKey: value, capturedAt: Date.now() }));
  return f;
}

afterEach(() => {
  if (priorKey === undefined) delete process.env.RESY_API_KEY;
  else process.env.RESY_API_KEY = priorKey;
  if (priorFile === undefined) delete process.env.RESY_API_KEY_FILE;
  else process.env.RESY_API_KEY_FILE = priorFile;
});

describe('resolveApiKey precedence', () => {
  it('falls back to the compiled-in key when nothing else is available', () => {
    delete process.env.RESY_API_KEY;
    process.env.RESY_API_KEY_FILE = join(mkdtempSync(join(tmpdir(), 'resy-ak-')), 'none.json');
    expect(resolveApiKey()).toBe(COMPILED_IN);
  });

  // The whole point: a rotated key is picked up without anyone intervening.
  it('prefers a captured key over the compiled-in one', () => {
    delete process.env.RESY_API_KEY;
    process.env.RESY_API_KEY_FILE = cacheHolding(CAPTURED);
    expect(resolveApiKey()).toBe(CAPTURED);
  });

  // An operator pinning a key is making a deliberate choice; a snapshot of the
  // site must not silently beat it.
  it('lets an explicit RESY_API_KEY override beat a captured key', () => {
    process.env.RESY_API_KEY = 'operator-pinned-key';
    process.env.RESY_API_KEY_FILE = cacheHolding(CAPTURED);
    expect(resolveApiKey()).toBe('operator-pinned-key');
  });
});
