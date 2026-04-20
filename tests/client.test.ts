import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.RESY_EMAIL = 'test@example.com';
process.env.RESY_PASSWORD = 'pw';

const { ResyClient } = await import('../src/client.js');

describe('ResyClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
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

  it('throws at first request if RESY_EMAIL missing', async () => {
    const orig = process.env.RESY_EMAIL;
    process.env.RESY_EMAIL = '';
    const client = new ResyClient();
    await expect(client.request('GET', '/x')).rejects.toThrow(
      /RESY_EMAIL and RESY_PASSWORD/
    );
    process.env.RESY_EMAIL = orig;
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
});
