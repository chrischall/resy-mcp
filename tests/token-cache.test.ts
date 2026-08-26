import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  tokenCachePath,
  createTokenCache,
  reportCacheWriteFailure,
} from '../src/token-cache.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'resy-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pw = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  MCP_DATA_DIR: dir,
  RESY_EMAIL: 'diner@example.com',
  RESY_PASSWORD: 'pw1',
  RESY_TOKEN_CACHE: 'true',
  ...over,
});

const token = (over: Partial<{ accessToken: string; expiresAt: number }> = {}) => ({
  accessToken: 'TOK',
  refreshToken: 'resy-reauth',
  expiresAt: Date.UTC(9999, 0, 1),
  ...over,
});

const cacheFile = (d: string): string => join(d, '.resy-mcp', 'token.json');

describe('tokenCachePath', () => {
  it('prefers MCP_DATA_DIR, the variable mcp-host injects', () => {
    expect(tokenCachePath({ MCP_DATA_DIR: '/data' })).toBe('/data/.resy-mcp/token.json');
  });

  it('honours an explicit RESY_TOKEN_FILE', () => {
    expect(tokenCachePath({ RESY_TOKEN_FILE: '/tmp/x.json', MCP_DATA_DIR: '/data' })).toBe(
      '/tmp/x.json',
    );
  });

  it('ignores a sentinel override rather than making a relative ./null', () => {
    expect(tokenCachePath({ RESY_TOKEN_FILE: 'null', HOME: '/home/u' })).toBe(
      '/home/u/.resy-mcp/token.json',
    );
  });
});

describe('which auth paths are worth caching', () => {
  it('caches a password login', () => {
    expect(createTokenCache(pw())).not.toBeNull();
  });

  it('caches the fetchproxy path — a cached token means a cold start needs no browser', () => {
    expect(createTokenCache({ MCP_DATA_DIR: dir, RESY_TOKEN_CACHE: 'true' })).not.toBeNull();
  });

  it('does NOT cache RESY_AUTH_TOKEN — the token IS the env var', () => {
    // There is no mint to skip; caching would only copy a credential to disk.
    expect(createTokenCache(pw({ RESY_AUTH_TOKEN: 'static-token' }))).toBeNull();
  });

  it('does NOT cache when fetchproxy is disabled and no credentials are set', () => {
    expect(
      createTokenCache({
        MCP_DATA_DIR: dir,
        RESY_TOKEN_CACHE: 'true',
        RESY_DISABLE_FETCHPROXY: '1',
      }),
    ).toBeNull();
  });

  it('is disabled by RESY_TOKEN_CACHE=false, and writes nothing', () => {
    expect(createTokenCache(pw({ RESY_TOKEN_CACHE: 'false' }))).toBeNull();
    expect(existsSync(join(dir, '.resy-mcp'))).toBe(false);
  });
});

describe('the never-expires sentinel survives a round trip', () => {
  it('restores a token stamped with NEVER_EXPIRES', () => {
    // The regression this exists for: client.ts used Number.POSITIVE_INFINITY,
    // which JSON.stringify writes as `null`. The record was written on every
    // mint and rejected on every load — a cache that silently did nothing while
    // a "it saves the token" test still passed. A finite far-future stamp is
    // what makes the restore real, so assert the restore, not the write.
    const p = createTokenCache(pw())!;
    p.save(token());
    expect(p.load()).toEqual(expect.objectContaining({ accessToken: 'TOK' }));
    expect(p.load()?.expiresAt).toBe(Date.UTC(9999, 0, 1));
  });

  it('rejects a record whose expiry did not survive as a number', () => {
    const p = createTokenCache(pw())!;
    p.save(token());
    const envelope = JSON.parse(readFileSync(cacheFile(dir), 'utf8')) as {
      state: { expiresAt: unknown };
    };
    // Exactly what an Infinity would have left behind.
    envelope.state.expiresAt = null;
    writeFileSync(cacheFile(dir), JSON.stringify(envelope), { mode: 0o600 });
    expect(createTokenCache(pw())!.load()).toBeNull();
  });
});

describe('credential binding', () => {
  it('round-trips through a 0600 file for the same credentials', () => {
    createTokenCache(pw())!.save(token());
    expect(statSync(cacheFile(dir)).mode & 0o777).toBe(0o600);
    expect(createTokenCache(pw())!.load()).toEqual(expect.objectContaining({ accessToken: 'TOK' }));
  });

  it.each([
    ['a rotated password', pw({ RESY_PASSWORD: 'pw2' })],
    ['a different account', pw({ RESY_EMAIL: 'other@example.com' })],
  ])('discards the cache on %s', (_label, env) => {
    createTokenCache(pw())!.save(token());
    expect(createTokenCache(env)!.load()).toBeNull();
  });

  it('does not reuse a password-minted token on the fetchproxy path', () => {
    // The mode is part of the binding, so a token minted one way is not read
    // back by the other.
    createTokenCache(pw())!.save(token());
    const bridge = { MCP_DATA_DIR: dir, RESY_TOKEN_CACHE: 'true' };
    expect(createTokenCache(bridge)!.load()).toBeNull();
  });

  it('matches the email case-insensitively', () => {
    createTokenCache(pw())!.save(token());
    expect(createTokenCache(pw({ RESY_EMAIL: '  Diner@Example.COM ' }))!.load()).not.toBeNull();
  });

  it('writes no credential material to disk', () => {
    createTokenCache(pw())!.save(token());
    const body = readFileSync(cacheFile(dir), 'utf8');
    expect(body).not.toContain('pw1');
    expect(body).not.toContain('diner@example.com');
  });
});

describe('stored-record shape guard', () => {
  it.each([
    ['null', null],
    ['a primitive', 'nope'],
    ['a missing accessToken', { expiresAt: 1 }],
    ['an empty accessToken', { accessToken: '', expiresAt: 1 }],
    ['a non-numeric expiresAt', { accessToken: 'T', expiresAt: 'soon' }],
    ['a non-string refreshToken', { accessToken: 'T', refreshToken: 7, expiresAt: 1 }],
  ])('rejects %s rather than handing it to the token manager', (_label, body) => {
    const p = createTokenCache(pw())!;
    p.save(token());
    // Swap only the STATE, keeping the envelope's salted binding intact —
    // overwriting the whole file would be rejected by the binding check before
    // the shape guard ever ran, which is the wrong reason to pass.
    const envelope = JSON.parse(readFileSync(cacheFile(dir), 'utf8')) as { state: unknown };
    envelope.state = body;
    writeFileSync(cacheFile(dir), JSON.stringify(envelope), { mode: 0o600 });
    expect(createTokenCache(pw())!.load()).toBeNull();
  });

  it('accepts a record with no refreshToken', () => {
    const p = createTokenCache(pw())!;
    p.save({ accessToken: 'TOK', expiresAt: 42 });
    expect(p.load()).toEqual({ accessToken: 'TOK', expiresAt: 42 });
  });
});

describe('reportCacheWriteFailure', () => {
  it.each([
    ['an Error', new Error('EROFS'), 'EROFS'],
    ['a non-Error', 'disk gone', 'disk gone'],
  ])('names the cause for %s and stays on stderr', (_label, thrown, expected) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      reportCacheWriteFailure(thrown);
      expect(err).toHaveBeenCalledWith(expect.stringContaining(expected as string));
      // stdout is the JSON-RPC channel; a stray write there corrupts the stream.
      expect(out).not.toHaveBeenCalled();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });
});
