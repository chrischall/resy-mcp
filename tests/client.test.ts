import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.RESY_EMAIL = 'test@example.com';
process.env.RESY_PASSWORD = 'pw';
// Default: no token override, fetchproxy enabled. Individual tests override.
delete process.env.RESY_AUTH_TOKEN;
delete process.env.RESY_DISABLE_FETCHPROXY;

// Mock the fetchproxy bootstrap so client tests never hit the real bridge.
// Individual tests override mintTokenViaFetchproxy via mockResolvedValueOnce /
// mockRejectedValueOnce.
const mintTokenViaFetchproxy = vi.fn();
vi.mock('../src/auth-fetchproxy.js', () => ({
  mintTokenViaFetchproxy,
}));

const { ResyClient } = await import('../src/client.js');

describe('ResyClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mintTokenViaFetchproxy.mockReset();
    // Per-test default: RESY_EMAIL + RESY_PASSWORD path is active.
    process.env.RESY_EMAIL = 'test@example.com';
    process.env.RESY_PASSWORD = 'pw';
    delete process.env.RESY_AUTH_TOKEN;
    delete process.env.RESY_DISABLE_FETCHPROXY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('logs in on first request then uses the token', async () => {
    const mockFetch = vi.fn()
      // login response
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 'auth-xyz' }),
      })
      // actual request
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ first_name: 'Chris' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const data = await client.request('GET', '/2/user');

    expect(data).toEqual({ first_name: 'Chris' });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [loginUrl, loginInit] = mockFetch.mock.calls[0];
    expect(loginUrl).toBe('https://api.resy.com/3/auth/password');
    expect(loginInit.method).toBe('POST');
    expect(loginInit.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(loginInit.body).toContain('email=test%40example.com');
    expect(loginInit.body).toContain('password=pw');

    const [reqUrl, reqInit] = mockFetch.mock.calls[1];
    expect(reqUrl).toBe('https://api.resy.com/2/user');
    expect(reqInit.headers.Authorization).toBe(
      'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"'
    );
    expect(reqInit.headers['x-resy-auth-token']).toBe('auth-xyz');
    expect(reqInit.headers['x-resy-universal-auth']).toBe('auth-xyz');
    expect(reqInit.headers.Origin).toBe('https://resy.com');
    expect(reqInit.headers.Referer).toBe('https://resy.com/');
  });

  it('caches the token across calls (only logs in once)', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 'auth-xyz' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 2 }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    await client.request('GET', '/a');
    await client.request('GET', '/b');

    // login + 2 requests = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('falls through to fetchproxy when no email is set', async () => {
    process.env.RESY_EMAIL = '';
    mintTokenViaFetchproxy.mockResolvedValueOnce('fp-tk');

    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ ok: 1 }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const data = await client.request('GET', '/x');

    expect(data).toEqual({ ok: 1 });
    expect(mintTokenViaFetchproxy).toHaveBeenCalledTimes(1);
    // No /3/auth/password call — fetchproxy handled it
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers['x-resy-auth-token']).toBe('fp-tk');
    expect(init.headers['x-resy-universal-auth']).toBe('fp-tk');
  });

  it('redacts a token echoed in a login-failure body', async () => {
    // /3/auth/password failure bodies are untrusted upstream text — an echoing
    // upstream/proxy could reflect credentials or tokens. They must be
    // redacted before reaching the thrown (tool-result-visible) message.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjaHJpcyJ9.c2lnbmF0dXJlLXNlZ21lbnQ';
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 419,
      statusText: 'Auth Expired',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: `bad credentials, token ${jwt}` }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const err = await client.request('GET', '/x').then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e as Error
    );
    expect(err.message).toContain('Resy login failed: 419');
    expect(err.message).not.toContain(jwt);
    expect(err.message).toContain('[REDACTED]');
  });

  it('redacts a token echoed in a login response missing a token field', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjaHJpcyJ9.c2lnbmF0dXJlLXNlZ21lbnQ';
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ weird: `Bearer ${jwt}` }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const err = await client.request('GET', '/x').then(
      () => {
        throw new Error('expected rejection');
      },
      (e: unknown) => e as Error
    );
    expect(err.message).toContain('Resy login response did not contain a token');
    expect(err.message).not.toContain(jwt);
    expect(err.message).toContain('[REDACTED]');
  });

  it.each(['true', 'yes', 'on', 'TRUE'])(
    'RESY_DISABLE_FETCHPROXY=%s disables the fetchproxy fallback',
    async (value) => {
      process.env.RESY_EMAIL = '';
      process.env.RESY_PASSWORD = '';
      process.env.RESY_DISABLE_FETCHPROXY = value;

      const client = new ResyClient();
      await expect(client.request('GET', '/x')).rejects.toThrow(
        /set RESY_EMAIL.*RESY_PASSWORD.*RESY_AUTH_TOKEN.*fetchproxy/
      );
      expect(mintTokenViaFetchproxy).not.toHaveBeenCalled();
    }
  );

  it('throws guidance error when no email/password and fetchproxy is disabled', async () => {
    process.env.RESY_EMAIL = '';
    process.env.RESY_PASSWORD = '';
    process.env.RESY_DISABLE_FETCHPROXY = '1';

    const client = new ResyClient();
    await expect(client.request('GET', '/x')).rejects.toThrow(
      /set RESY_EMAIL.*RESY_PASSWORD.*RESY_AUTH_TOKEN.*fetchproxy/
    );
    expect(mintTokenViaFetchproxy).not.toHaveBeenCalled();
  });

  it('throws guidance error when fetchproxy fallback itself fails', async () => {
    process.env.RESY_EMAIL = '';
    process.env.RESY_PASSWORD = '';
    mintTokenViaFetchproxy.mockRejectedValueOnce(new Error('no signed-in tab'));

    const client = new ResyClient();
    await expect(client.request('GET', '/x')).rejects.toThrow(
      /fetchproxy fallback failed.*no signed-in tab.*RESY_EMAIL.*RESY_AUTH_TOKEN/s
    );
  });

  it('re-logs in and retries once on 401', async () => {
    const mockFetch = vi.fn()
      // first login
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 'token-old' }),
      })
      // first request → 401
      .mockResolvedValueOnce({
        ok: false, status: 401, statusText: 'Unauthorized',
        headers: new Headers(),
        text: async () => 'unauthorized',
      })
      // second login
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 'token-new' }),
      })
      // retry succeeds
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: true }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const data = await client.request('GET', '/2/user');

    expect(data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // retry used the new token
    const [, retryInit] = mockFetch.mock.calls[3];
    expect(retryInit.headers['x-resy-auth-token']).toBe('token-new');
  });

  it('throws session-rejected if second attempt also 401', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 401, statusText: 'Unauthorized',
        headers: new Headers(),
        text: async () => 'no',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't2' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 401, statusText: 'Unauthorized',
        headers: new Headers(),
        text: async () => 'still no',
      })
    );

    const client = new ResyClient();
    await expect(client.request('GET', '/x')).rejects.toThrow(
      /session rejected.*RESY_EMAIL.*RESY_PASSWORD/
    );
  });

  it('treats 419 the same as 401', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 419, statusText: 'Authentication Timeout',
        headers: new Headers(),
        text: async () => 'session expired',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't2' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 1 }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const data = await client.request('GET', '/x');
    expect(data).toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('retries once on 429 after 2s', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 429, statusText: 'Too Many Requests',
        headers: new Headers(),
        text: async () => 'slow down',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: true }),
      });
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    const client = new ResyClient();
    const promise = client.request('GET', '/x');
    await vi.advanceTimersByTimeAsync(2000);
    const data = await promise;

    expect(data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws rate-limit error if 429 persists', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValue({
        ok: false, status: 429, statusText: 'Too Many Requests',
        headers: new Headers(),
        text: async () => 'slow down',
      });
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    const client = new ResyClient();
    const promise = client.request('GET', '/x');
    // Attach the rejection handler BEFORE advancing timers so the rejection
    // is never observed as "unhandled" by Node/vitest.
    const assertion = expect(promise).rejects.toThrow(/rate limited by Resy/i);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('treats 500 with auth-like body as auth failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 500, statusText: 'Server Error',
        headers: new Headers(),
        text: async () => 'invalid auth token',
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't2' }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 1 }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    const data = await client.request('GET', '/x');
    expect(data).toEqual({ ok: 1 });
  });

  it('does NOT treat 500 with non-auth "token" phrase as auth failure', async () => {
    // Regression guard: "book_token expired" contains "token" but is a
    // different failure mode (stale booking token), not an auth failure.
    // Must surface as a generic 500 error, not trigger a re-login.
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 500, statusText: 'Server Error',
        headers: new Headers(),
        text: async () => 'book_token expired',
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    await expect(client.request('GET', '/3/book')).rejects.toThrow(
      /Resy API error: 500 Server Error for GET \/3\/book/
    );
    expect(mockFetch).toHaveBeenCalledTimes(2); // login + request, no second login
  });

  it('throws on 404 with status info', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ token: 't' }),
      })
      .mockResolvedValueOnce({
        ok: false, status: 404, statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'missing',
      });
    vi.stubGlobal('fetch', mockFetch);

    const client = new ResyClient();
    await expect(client.request('GET', '/3/venue?id=999')).rejects.toThrow(
      /Resy API error: 404 Not Found for GET \/3\/venue\?id=999/
    );
  });

  // --- Auth path selection (new) -------------------------------------------

  describe('auth path selection', () => {
    it('uses RESY_AUTH_TOKEN verbatim and skips login + fetchproxy', async () => {
      process.env.RESY_AUTH_TOKEN = 'direct-tk';
      // No email/password fall-through
      process.env.RESY_EMAIL = '';
      process.env.RESY_PASSWORD = '';

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new ResyClient();
      const data = await client.request('GET', '/x');
      expect(data).toEqual({ ok: 1 });

      // No login network call, no fetchproxy call
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mintTokenViaFetchproxy).not.toHaveBeenCalled();

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['x-resy-auth-token']).toBe('direct-tk');
      expect(init.headers['x-resy-universal-auth']).toBe('direct-tk');
    });

    it('prefers RESY_AUTH_TOKEN even when email+password are set', async () => {
      process.env.RESY_AUTH_TOKEN = 'direct-tk';
      // Email & password remain set, but the override wins
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ ok: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const client = new ResyClient();
      await client.request('GET', '/x');
      expect(mockFetch).toHaveBeenCalledTimes(1); // no login call
    });

    it('RESY_DISABLE_FETCHPROXY=1 skips the fetchproxy fallback', async () => {
      process.env.RESY_EMAIL = '';
      process.env.RESY_PASSWORD = '';
      process.env.RESY_DISABLE_FETCHPROXY = '1';

      const client = new ResyClient();
      await expect(client.request('GET', '/x')).rejects.toThrow(
        /set RESY_EMAIL.*RESY_AUTH_TOKEN.*fetchproxy/s
      );
      expect(mintTokenViaFetchproxy).not.toHaveBeenCalled();
    });

    it('refreshToken via fetchproxy on 401 retry', async () => {
      // Start without password env so the initial token comes from fetchproxy
      process.env.RESY_EMAIL = '';
      process.env.RESY_PASSWORD = '';

      mintTokenViaFetchproxy
        .mockResolvedValueOnce('fp-tk-1')
        .mockResolvedValueOnce('fp-tk-2');

      const mockFetch = vi.fn()
        // first request → 401
        .mockResolvedValueOnce({
          ok: false, status: 401, statusText: 'Unauthorized',
          headers: new Headers(),
          text: async () => 'unauthorized',
        })
        // retry succeeds with new token
        .mockResolvedValueOnce({
          ok: true, status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ ok: true }),
        });
      vi.stubGlobal('fetch', mockFetch);

      const client = new ResyClient();
      const data = await client.request('GET', '/x');
      expect(data).toEqual({ ok: true });

      // fetchproxy invoked twice (bootstrap + post-401 refresh)
      expect(mintTokenViaFetchproxy).toHaveBeenCalledTimes(2);
      // Second call used the refreshed token
      const [, retryInit] = mockFetch.mock.calls[1];
      expect(retryInit.headers['x-resy-auth-token']).toBe('fp-tk-2');
    });
  });
});

describe('ResyClient — a failed re-mint does not re-mint again', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mintTokenViaFetchproxy.mockReset();
    process.env.RESY_EMAIL = 'test@example.com';
    process.env.RESY_PASSWORD = 'pw';
    delete process.env.RESY_AUTH_TOKEN;
    delete process.env.RESY_DISABLE_FETCHPROXY;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the re-mint failure instead of repeating it', async () => {
    // Minting IS logging in here, so the library's re-mint-after-a-failed-
    // refresh recovery would just repeat the call that just failed against
    // Resy's auth endpoint. `isRefreshRevoked: () => false` turns it off.
    //
    // The bootstrap must SUCCEED first — a failed FIRST mint never reaches the
    // recovery path at all, so mocking that would exercise nothing. Sequence:
    // login ok, API 401 (drives withAuth's replay), re-login fails.
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValue(new Response('nope', { status: 401, statusText: 'Unauthorized' }));

    const client = new ResyClient();
    await expect(client.request('GET', '/2/config')).rejects.toThrow();

    const loginCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('/3/auth/password'),
    );
    // Two: the successful bootstrap and the one failed re-mint. A third would
    // be the recovery this deliberately disables.
    expect(loginCalls).toHaveLength(2);
  });
});
