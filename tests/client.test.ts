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
});
