import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit-test the fetchproxy bootstrap helper in isolation.
 *
 * The bootstrap now constructs its bridge via
 * `@chrischall/mcp-utils/fetchproxy`'s `createFetchproxyTransport`, so we mock
 * that seam: the factory records the opts it was handed (the same trust-boundary
 * fields the old `FetchproxyServer` constructor received — `domains`, etc.) and
 * returns a transport whose `start`/`close` and `server.postJson` are our spies.
 * The test never opens a real WS. The full integration through ResyClient (auth
 * path selection, header wiring) is exercised in tests/client.test.ts.
 *
 * `start()` is the lifecycle's `listen()`; `mockListen` is kept under that name
 * so the existing assertions read unchanged.
 */

const mockListen = vi.fn();
const mockClose = vi.fn();
const mockPostJson = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@chrischall/mcp-utils/fetchproxy', () => ({
  createFetchproxyTransport: (opts: unknown) => {
    mockConstructor(opts);
    return {
      start: mockListen,
      close: mockClose,
      server: { postJson: mockPostJson },
    };
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
      keepAliveIntervalMs?: number;
    };
    expect(opts.domains).toEqual(['resy.com']);
    // We used to opt into keep-alive pings (keepAliveIntervalMs: 25_000) so
    // the SW stayed resident through long sessions and token-refresh
    // round-trips didn't pay a cold-revive penalty. @fetchproxy/server
    // 0.10.0 makes 25_000 the server default (fetchproxy#72), so we pass
    // nothing for it now and rely on that default.
    expect(opts.keepAliveIntervalMs).toBeUndefined();
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
  /**
   * The bridge port the host hands the child.
   *
   * mcp-host's `bridgePortEnv` names an environment variable and expects the
   * server to bind the port it finds there — that is the whole mechanism by
   * which a hosted, bridged registration is reachable. Until this existed,
   * resy-mcp took no port at all, so `createFetchproxyTransport` used the
   * library default and a `bridgePortEnv` on the registration would have named
   * a variable nothing read: the host would believe it had placed the bridge
   * and the child would be listening somewhere else.
   */
  describe('the bridge port', () => {
    it('defaults to the shared fleet concentrator port', async () => {
      delete process.env.RESY_WS_PORT;
      mockPostJson.mockResolvedValue({ token: 'tok' });
      await mintTokenViaFetchproxy();
      const opts = mockConstructor.mock.calls[0][0] as { port?: number };
      // ONE port for the whole fleet — the Transporter extension dials it and
      // servers peer-elect on it. A "unique" per-MCP default would be a bug.
      expect(opts.port).toBe(37_149);
    });

    it('binds RESY_WS_PORT when the host sets one', async () => {
      process.env.RESY_WS_PORT = '41999';
      mockPostJson.mockResolvedValue({ token: 'tok' });
      await mintTokenViaFetchproxy();
      const opts = mockConstructor.mock.calls[0][0] as { port?: number };
      expect(opts.port).toBe(41_999);
    });

    it('falls back to the default for junk or an unexpanded placeholder', async () => {
      // `${RESY_WS_PORT}` reaching the child unsubstituted is the exact shape
      // that used to hand `NaN` to the server across the fleet.
      for (const junk of ['${RESY_WS_PORT}', 'not-a-port', '0', '70000', '']) {
        vi.resetModules();
        mockConstructor.mockReset();
        mockPostJson.mockReset().mockResolvedValue({ token: 'tok' });
        process.env.RESY_WS_PORT = junk;
        const mod = await import('../src/auth-fetchproxy.js');
        await mod.mintTokenViaFetchproxy();
        const opts = mockConstructor.mock.calls[0][0] as { port?: number };
        expect(opts.port, `for ${JSON.stringify(junk)}`).toBe(37_149);
      }
      delete process.env.RESY_WS_PORT;
    });
  });
});
