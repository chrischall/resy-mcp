import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit-test the fetchproxy bootstrap helper in isolation.
 *
 * We mock `@fetchproxy/server`'s `FetchproxyServer` constructor so the
 * test never opens a real WS. The full integration through ResyClient
 * (auth path selection, header wiring) is exercised in tests/client.test.ts.
 */

const mockListen = vi.fn();
const mockClose = vi.fn();
const mockPostJson = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@fetchproxy/server', () => ({
  FetchproxyServer: class {
    constructor(opts: unknown) {
      mockConstructor(opts);
    }
    listen = mockListen;
    close = mockClose;
    postJson = mockPostJson;
  },
}));

describe('mintTokenViaFetchproxy', () => {
  let mintTokenViaFetchproxy: typeof import('../src/auth-fetchproxy.js').mintTokenViaFetchproxy;

  beforeEach(async () => {
    vi.resetModules();
    mockListen.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockPostJson.mockReset();
    mockConstructor.mockReset();
    ({ mintTokenViaFetchproxy } = await import('../src/auth-fetchproxy.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mints a token by POSTing /3/auth/refresh through fetchproxy', async () => {
    mockPostJson.mockResolvedValueOnce({ token: 'fresh-tk' });

    const token = await mintTokenViaFetchproxy();

    expect(token).toBe('fresh-tk');
    // Construction declared the right trust boundary
    expect(mockConstructor).toHaveBeenCalledTimes(1);
    const opts = mockConstructor.mock.calls[0][0] as {
      domains: string[];
      keepAliveIntervalMs: number;
    };
    expect(opts.domains).toEqual(['resy.com']);
    // fetchproxy#71 — opt into keep-alive pings so the SW stays resident
    // through long sessions and token-refresh round-trips don't pay a
    // cold-revive penalty.
    expect(opts.keepAliveIntervalMs).toBe(25_000);
    // listen() before any request
    expect(mockListen).toHaveBeenCalledTimes(1);
    // postJson targets api.resy.com
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    const [path, body, callOpts] = mockPostJson.mock.calls[0];
    expect(path).toBe('/3/auth/refresh');
    expect(body).toEqual({});
    expect(callOpts).toMatchObject({ subdomain: 'api' });
    // close() called on the way out
    expect(mockClose).toHaveBeenCalled();
  });

  it('throws if the response has no token field', async () => {
    mockPostJson.mockResolvedValueOnce({});
    await expect(mintTokenViaFetchproxy()).rejects.toThrow(/no token/);
    // Still cleaned up even on failure
    expect(mockClose).toHaveBeenCalled();
  });

  it('throws if the token field is not a non-empty string', async () => {
    mockPostJson.mockResolvedValueOnce({ token: '' });
    await expect(mintTokenViaFetchproxy()).rejects.toThrow(/no token/);
    expect(mockClose).toHaveBeenCalled();
  });

  it('propagates bridge errors from postJson', async () => {
    mockPostJson.mockRejectedValueOnce(new Error('no signed-in tab'));
    await expect(mintTokenViaFetchproxy()).rejects.toThrow(/no signed-in tab/);
    expect(mockClose).toHaveBeenCalled();
  });

  it('still closes the bridge if listen() failed', async () => {
    mockListen.mockRejectedValueOnce(new Error('port in use'));
    await expect(mintTokenViaFetchproxy()).rejects.toThrow(/port in use/);
    expect(mockClose).toHaveBeenCalled();
    // postJson was never reached
    expect(mockPostJson).not.toHaveBeenCalled();
  });

  it('swallows shutdown errors from close()', async () => {
    mockPostJson.mockResolvedValueOnce({ token: 'tk' });
    mockClose.mockRejectedValueOnce(new Error('already closed'));
    // Token should still come back successfully
    await expect(mintTokenViaFetchproxy()).resolves.toBe('tk');
  });
});
