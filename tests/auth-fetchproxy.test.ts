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
const mockCapture = vi.fn();
const mockConstructor = vi.fn();

vi.mock('@chrischall/mcp-utils/fetchproxy', () => ({
  // Mirrors the real helper closely enough to assert on: it derives the
  // capability from the declaration, which is the property that stops a
  // capture being declared without its verb unlocked.
  createBootstrapOpts: (args: { domains: string | string[]; bootstrap?: { captureHeaders?: unknown[] } }) => ({
    domains: Array.isArray(args.domains) ? args.domains : [args.domains],
    ...(args.bootstrap?.captureHeaders
      ? {
          captureHeaders: args.bootstrap.captureHeaders,
          capabilities: ['fetch', 'capture_request_header'],
        }
      : {}),
  }),
  createFetchproxyTransport: (opts: unknown) => {
    mockConstructor(opts);
    return {
      start: mockListen,
      close: mockClose,
      server: { postJson: mockPostJson, captureRequestHeader: mockCapture },
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
    // Capture is the PRIMARY path, so it must fail by default or every
    // pre-existing test asserting the /3/auth/refresh fallback would stop
    // exercising it.
    mockCapture.mockReset().mockRejectedValue(new Error('no capture in this test'));
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
   * Reading the token off the page's own traffic, rather than asking for one.
   *
   * `/3/auth/refresh` is a CROSS-ORIGIN POST to api.resy.com, and the isolated
   * world cannot make those — measured against the live bridge, a same-origin
   * GET to resy.com returns 200 while every api.resy.com call fails with
   * "Failed to fetch". resy.com's own JS makes that call constantly and sends
   * `x-resy-auth-token` with it, so the bridge does not need to issue a
   * request at all: it can snapshot the header off one the page already made.
   *
   * Cheaper and narrower than routing a credentialed request through the MAIN
   * world (`fetch_in_page`): nothing crosses into the page, and no request is
   * exposed to a patched `window.fetch`.
   */
  describe('capture-first mint', () => {
    it('declares the capture and the capability that unlocks it', async () => {
      mockCapture.mockResolvedValueOnce('captured-tk-aaaaaaaaaaaaaaaaaaaaaa');
      await mintTokenViaFetchproxy();
      const opts = mockConstructor.mock.calls[0][0] as {
        capabilities?: string[];
        captureHeaders?: Array<{ host: string; headerName: string }>;
        domains: string[];
      };
      expect(opts.capabilities).toContain('capture_request_header');
      // The fallback POST needs the fetch verb, and `capabilities` REPLACES
      // the server's default rather than extending it — so a declaration that
      // does not carry `fetch` silently locks it. Supplied by
      // createBootstrapOpts since @chrischall/mcp-utils 0.19.4 (the floor in
      // package.json); asserted here because this call site is where losing it
      // would surface, as `capability "fetch" not granted`.
      expect(opts.capabilities).toContain('fetch');
      expect(opts.captureHeaders).toEqual([
        { host: 'api.resy.com', path: '/*', headerName: 'x-resy-auth-token' },
      ]);
      // The capture target is a subdomain of the declared trust boundary.
      expect(opts.domains).toEqual(['resy.com']);
    });

    it('returns the captured header without issuing any request', async () => {
      mockCapture.mockResolvedValueOnce('captured-tk-aaaaaaaaaaaaaaaaaaaaaa');
      const token = await mintTokenViaFetchproxy();
      expect(token).toBe('captured-tk-aaaaaaaaaaaaaaaaaaaaaa');
      expect(mockPostJson).not.toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });

    it('ignores a captured value too short to be a token and falls back', async () => {
      mockCapture.mockResolvedValueOnce('');
      mockPostJson.mockResolvedValueOnce({ token: 'refresh-tk' });
      expect(await mintTokenViaFetchproxy()).toBe('refresh-tk');
    });

    it('falls back to /3/auth/refresh when nothing is captured in time', async () => {
      mockCapture.mockRejectedValueOnce(new Error('capture timed out'));
      mockPostJson.mockResolvedValueOnce({ token: 'refresh-tk' });
      expect(await mintTokenViaFetchproxy()).toBe('refresh-tk');
      expect(mockPostJson).toHaveBeenCalledTimes(1);
    });

    it('names BOTH failures when neither path yields a token', async () => {
      mockCapture.mockRejectedValueOnce(new Error('capture timed out'));
      mockPostJson.mockRejectedValueOnce(new Error('fetch threw: Failed to fetch'));
      await expect(mintTokenViaFetchproxy()).rejects.toThrow(/capture timed out[\s\S]*Failed to fetch/);
    });
  });

  /**
   * The fallback needs the MAIN world to be reachable at all.
   *
   * `/3/auth/refresh` is CROSS-ORIGIN to the relaying resy.com tab, and the
   * isolated world cannot make those — which is why capture came first. The
   * MAIN world can: it is the world resy.com's own JS runs in, and it makes
   * that exact call. `fetch_in_page` (fetchproxy 2.4.0) routes one request
   * there, so the fallback becomes usable instead of guaranteed to fail.
   *
   * This matters for the case capture cannot serve: a cold start against an
   * IDLE tab, where no request arrives to read a header from.
   */
  describe('the /3/auth/refresh fallback runs in the page', () => {
    it('declares fetch_in_page alongside the derived capabilities', async () => {
      mockPostJson.mockResolvedValueOnce({ token: 'tk' });
      await mintTokenViaFetchproxy();
      const opts = mockConstructor.mock.calls[0][0] as { capabilities?: string[] };
      expect(opts.capabilities).toEqual(
        expect.arrayContaining(['fetch', 'capture_request_header', 'fetch_in_page']),
      );
    });

    it('sets inPage on the refresh call, beside the relay tab', async () => {
      mockPostJson.mockResolvedValueOnce({ token: 'tk' });
      await mintTokenViaFetchproxy();
      const [, , opts] = mockPostJson.mock.calls[0] as [string, unknown, Record<string, unknown>];
      // All three are load-bearing and independent: api.resy.com carries the
      // REQUEST, resy.com carries the TAB, and the page's own world ISSUES it.
      expect(opts).toMatchObject({ subdomain: 'api', viaTab: 'https://resy.com/', inPage: true });
    });

    it('still prefers capture — inPage is the fallback, not the default', async () => {
      mockCapture.mockResolvedValueOnce('captured-tk-aaaaaaaaaaaaaaaaaaaaaa');
      await mintTokenViaFetchproxy();
      // Nothing was routed through the page when a header was there to read.
      expect(mockPostJson).not.toHaveBeenCalled();
    });
  });

  /**
   * The relay tab must be named explicitly.
   *
   * The bootstrap POSTs `/3/auth/refresh` with `subdomain: 'api'`, and the
   * transport derives the relaying tab from the REQUEST's host — so it looks
   * for a tab on api.resy.com. That host serves no app and never has a tab, so
   * the mint failed with "no tab matching https://api.resy.com/" no matter how
   * signed in the user was. The signed-in resy.com tab can issue that call
   * perfectly well; it is what the site's own JS does. `viaTab` names it,
   * which is the case that option exists for.
   */
  it('routes the refresh through the resy.com tab, not the api host', async () => {
    mockPostJson.mockResolvedValueOnce({ token: 'tk' });
    await mintTokenViaFetchproxy();
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    const [path, body, opts] = mockPostJson.mock.calls[0] as [string, unknown, Record<string, unknown>];
    expect(path).toBe('/3/auth/refresh');
    expect(body).toEqual({});
    // api.resy.com carries the REQUEST; resy.com carries the TAB.
    expect(opts).toMatchObject({ subdomain: 'api', viaTab: 'https://resy.com/' });
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
