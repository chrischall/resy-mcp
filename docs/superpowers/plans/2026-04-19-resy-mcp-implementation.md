# Resy MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that exposes Resy reservation management (search, book, list, cancel, favorites, priority notify) as 13 tools, matching the conventions of the user's `splitwise-mcp` and `ofw-mcp`.

**Architecture:** TypeScript + ESM + Node ≥ 18. Stdio transport only. Single `ResyClient` class handles email/password login, token caching, and retry/refresh on 401/419/429. Tools are split by concern across five files. Build via `tsc` typecheck + `esbuild` bundle to `dist/bundle.js`. TDD throughout — every runtime behaviour has a failing test first, then implementation.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `dotenv`, `vitest`, `esbuild`.

---

## File Layout

**Created by this plan:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- `src/index.ts` — MCP bootstrap
- `src/client.ts` — `ResyClient` (auth, request, retry)
- `src/tools/user.ts`
- `src/tools/venues.ts`
- `src/tools/reservations.ts`
- `src/tools/favorites.ts`
- `src/tools/notify.ts`
- `tests/helpers.ts` — MCP in-memory test harness
- `tests/client.test.ts`
- `tests/tools/user.test.ts`
- `tests/tools/venues.test.ts`
- `tests/tools/reservations.test.ts`
- `tests/tools/favorites.test.ts`
- `tests/tools/notify.test.ts`
- `scripts/smoke.ts` — manual endpoint verification
- `manifest.json` — MCPB descriptor
- `README.md`, `CLAUDE.md`

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/index.ts` (placeholder so tsc has something to compile)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "resy-mcp",
  "version": "0.1.0",
  "description": "Resy MCP server for Claude — developed and maintained by AI (Claude Code)",
  "author": "Claude Code (AI) <https://www.anthropic.com/claude>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/chrischall/resy-mcp.git"
  },
  "license": "MIT",
  "keywords": [
    "mcp",
    "model-context-protocol",
    "claude",
    "ai",
    "resy",
    "reservations",
    "restaurants",
    "dining",
    "booking"
  ],
  "type": "module",
  "bin": {
    "resy-mcp": "dist/bundle.js"
  },
  "files": [
    "dist",
    ".claude-plugin",
    ".mcp.json"
  ],
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --outfile=dist/bundle.js",
    "dev": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^17.4.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.5.2",
    "@vitest/coverage-v8": "^4.1.2",
    "esbuild": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
coverage/
.env
*.mcpb
*.skill
```

- [ ] **Step 5: Write `.env.example`**

```
RESY_EMAIL=you@example.com
RESY_PASSWORD=changeme
# Optional — only set if Resy rotates the public web-app key.
# RESY_API_KEY=VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5
```

- [ ] **Step 6: Write placeholder `src/index.ts` so tsc has an entry point**

```ts
#!/usr/bin/env node
// Bootstrap is written in Task 14.
export {};
```

- [ ] **Step 7: Install deps**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean typecheck).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example src/index.ts package-lock.json
git commit -m "scaffold: project config and empty entrypoint"
```

---

## Task 2: MCP test harness helper

**Files:**
- Create: `tests/helpers.ts`

This is the same pattern used in `splitwise-mcp/tests/helpers.ts` — a reusable in-memory MCP server+client pair so tool tests can `callTool('resy_xxx', {...})` without any transport.

- [ ] **Step 1: Write `tests/helpers.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function createTestHarness(
  registerFn: (server: McpServer) => void
): Promise<{
  client: Client;
  server: McpServer;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  listTools: () => Promise<{ name: string }[]>;
  close: () => Promise<void>;
}> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerFn(server);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    server,
    callTool: async (name, args) =>
      client.callTool({ name, arguments: args ?? {} }) as Promise<CallToolResult>,
    listTools: async () => {
      const result = await client.listTools();
      return result.tools.map((t) => ({ name: t.name }));
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers.ts
git commit -m "test: in-memory MCP test harness"
```

---

## Task 3: `ResyClient` — login + first authenticated request

**Files:**
- Test: `tests/client.test.ts`
- Create: `src/client.ts`

- [ ] **Step 1: Write failing test for login + auth-header injection**

Write `tests/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL — `Cannot find module '../src/client.js'`.

- [ ] **Step 3: Write minimal `src/client.ts`**

```ts
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // mcpb bundle won't have dotenv — rely on process.env set by mcp_config.env
}

const BASE_URL = 'https://api.resy.com';
const DEFAULT_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

const SPOOF_HEADERS = {
  Origin: 'https://resy.com',
  Referer: 'https://resy.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
} as const;

export type ResyBody =
  | undefined
  | Record<string, unknown>
  | URLSearchParams;

export class ResyClient {
  private readonly apiKey: string;
  private token: string | null = null;

  constructor() {
    this.apiKey = process.env.RESY_API_KEY || DEFAULT_API_KEY;
  }

  async request<T>(method: string, path: string, body?: ResyBody): Promise<T> {
    await this.ensureAuthenticated();
    return this.doRequest<T>(method, path, body, false);
  }

  private async doRequest<T>(
    method: string,
    path: string,
    body: ResyBody,
    _isRetry: boolean
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams;
    const headers: Record<string, string> = {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      'x-resy-auth-token': this.token!,
      'x-resy-universal-auth': this.token!,
      ...SPOOF_HEADERS,
    };
    if (body !== undefined) {
      headers['Content-Type'] = isForm
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: isForm ? (body as URLSearchParams).toString() : JSON.stringify(body) }
        : {}),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Resy API error: ${response.status} ${response.statusText} for ${method} ${path}`
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) return;
    await this.login();
  }

  private async login(): Promise<void> {
    const email = process.env.RESY_EMAIL;
    const password = process.env.RESY_PASSWORD;
    if (!email || !password) {
      throw new Error('RESY_EMAIL and RESY_PASSWORD must be set');
    }

    const response = await fetch(`${BASE_URL}/3/auth/password`, {
      method: 'POST',
      headers: {
        Authorization: `ResyAPI api_key="${this.apiKey}"`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...SPOOF_HEADERS,
      },
      body: new URLSearchParams({ email, password }).toString(),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Resy login failed: ${response.status} ${response.statusText}: ${text.slice(0, 200)}`
      );
    }

    const data = text ? JSON.parse(text) : {};
    const token =
      (typeof data.token === 'string' && data.token) ||
      (typeof data?.id?.token === 'string' && data.id.token) ||
      (typeof data.auth_token === 'string' && data.auth_token) ||
      null;
    if (!token) {
      throw new Error(
        `Resy login response did not contain a token: ${text.slice(0, 200)}`
      );
    }
    this.token = token;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/client.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): login and authenticated request"
```

---

## Task 4: `ResyClient` — 401/419 re-login + retry

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Append failing test**

Add to `tests/client.test.ts` inside the `describe('ResyClient', ...)` block:

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/client.test.ts`
Expected: the 3 new tests fail — current code throws on any non-2xx.

- [ ] **Step 3: Update `doRequest` in `src/client.ts`**

Replace the `doRequest` body with:

```ts
  private async doRequest<T>(
    method: string,
    path: string,
    body: ResyBody,
    isRetry: boolean
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams;
    const headers: Record<string, string> = {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      'x-resy-auth-token': this.token!,
      'x-resy-universal-auth': this.token!,
      ...SPOOF_HEADERS,
    };
    if (body !== undefined) {
      headers['Content-Type'] = isForm
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: isForm ? (body as URLSearchParams).toString() : JSON.stringify(body) }
        : {}),
    });

    if ((response.status === 401 || response.status === 419) && !isRetry) {
      this.token = null;
      await this.login();
      return this.doRequest<T>(method, path, body, true);
    }
    if (response.status === 401 || response.status === 419) {
      throw new Error(
        'Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD'
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Resy API error: ${response.status} ${response.statusText} for ${method} ${path}`
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/client.test.ts`
Expected: all passing (6 tests total so far).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): 401/419 re-login and retry"
```

---

## Task 5: `ResyClient` — 429 backoff + retry

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Append failing test**

Add to `tests/client.test.ts`:

```ts
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
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).rejects.toThrow(/rate limited by Resy/i);
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/client.test.ts`
Expected: the 2 new tests fail.

- [ ] **Step 3: Update `doRequest` — insert 429 branch after 401/419 block**

Add these lines before the `const text = await response.text();` line:

```ts
    if (response.status === 429 && !isRetry) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      return this.doRequest<T>(method, path, body, true);
    }
    if (response.status === 429) {
      throw new Error('Rate limited by Resy API');
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/client.test.ts`
Expected: all passing (8 tests so far).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): 429 backoff and retry"
```

---

## Task 6: `ResyClient` — 500-auth-like edge + non-2xx passthrough

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Append failing test**

Add to `tests/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/client.test.ts`
Expected: the 500-auth-like test fails (generic 500 throw). The 404 test should already pass.

- [ ] **Step 3: Restructure `doRequest` to read the body once and branch on content**

Replace `doRequest` in `src/client.ts` with:

```ts
  private async doRequest<T>(
    method: string,
    path: string,
    body: ResyBody,
    isRetry: boolean
  ): Promise<T> {
    const isForm = body instanceof URLSearchParams;
    const headers: Record<string, string> = {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      'x-resy-auth-token': this.token!,
      'x-resy-universal-auth': this.token!,
      ...SPOOF_HEADERS,
    };
    if (body !== undefined) {
      headers['Content-Type'] = isForm
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined
        ? { body: isForm ? (body as URLSearchParams).toString() : JSON.stringify(body) }
        : {}),
    });

    const text = await response.text();

    const looksLikeAuthFailure =
      response.status === 401 ||
      response.status === 419 ||
      (response.status === 500 && /unauthorized|auth|token/i.test(text));

    if (looksLikeAuthFailure && !isRetry) {
      this.token = null;
      await this.login();
      return this.doRequest<T>(method, path, body, true);
    }
    if (looksLikeAuthFailure) {
      throw new Error(
        'Resy session rejected — verify RESY_EMAIL / RESY_PASSWORD'
      );
    }

    if (response.status === 429 && !isRetry) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      return this.doRequest<T>(method, path, body, true);
    }
    if (response.status === 429) {
      throw new Error('Rate limited by Resy API');
    }

    if (!response.ok) {
      throw new Error(
        `Resy API error: ${response.status} ${response.statusText} for ${method} ${path}`
      );
    }

    return (text ? JSON.parse(text) : null) as T;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/client.test.ts`
Expected: all passing (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): auth-like 500 treated as auth failure"
```

---

## Task 7: User tool — `resy_get_profile`

**Files:**
- Create: `src/tools/user.ts`
- Create: `tests/tools/user.test.ts`

- [ ] **Step 1: Write failing test**

Write `tests/tools/user.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerUserTools } from '../../src/tools/user.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('user tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerUserTools(server, mockClient));
  });

  describe('resy_get_profile', () => {
    it('calls GET /2/user and returns a sanitised profile', async () => {
      mockRequest.mockResolvedValue({
        first_name: 'Chris',
        last_name: 'Chall',
        em_address: 'chris@example.com',
        mobile_number: '+15551234567',
        num_bookings: 42,
        date_created: '2020-01-15',
        resy_select: false,
        profile_image_url: 'https://...',
        payment_methods: [{ id: 99, brand: 'visa' }], // should be stripped
      });

      const result = await harness.callTool('resy_get_profile');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"first_name": "Chris"');
      expect(text).toContain('"email": "chris@example.com"');
      expect(text).toContain('"phone": "+15551234567"');
      expect(text).not.toContain('payment_methods');
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/user.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/user.js'`.

- [ ] **Step 3: Write `src/tools/user.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface ResyUser {
  first_name?: string;
  last_name?: string;
  em_address?: string;
  mobile_number?: string;
  num_bookings?: number;
  date_created?: string;
  resy_select?: boolean;
  profile_image_url?: string;
}

export function registerUserTools(server: McpServer, client: ResyClient): void {
  server.registerTool('resy_get_profile', {
    description: "Get the authenticated Resy user's profile (name, email, phone, booking count, member-since date). Payment method IDs are not exposed.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.request<ResyUser>('GET', '/2/user');
    const profile = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.em_address,
      phone: data.mobile_number,
      num_bookings: data.num_bookings,
      member_since: data.date_created,
      is_resy_select: data.resy_select,
      profile_image_url: data.profile_image_url,
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }] };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/user.test.ts`
Expected: 2 passing (setup + profile).

- [ ] **Step 5: Commit**

```bash
git add src/tools/user.ts tests/tools/user.test.ts
git commit -m "feat(tools): resy_get_profile"
```

---

## Task 8: Venue tools — `resy_search_venues`, `resy_find_slots`, `resy_get_venue`

**Files:**
- Create: `src/tools/venues.ts`
- Create: `tests/tools/venues.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/tools/venues.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerVenueTools } from '../../src/tools/venues.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('venue tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerVenueTools(server, mockClient));
  });

  describe('resy_search_venues', () => {
    it('POSTs form-encoded struct_data with defaults for lat/lng/limit', async () => {
      mockRequest.mockResolvedValue({
        search: {
          hits: [
            {
              id: { resy: 101 },
              name: 'Carbone',
              location: { locality: 'New York', region: 'NY', neighborhood: 'Greenwich Village' },
              cuisine: ['Italian'],
              price_range: 4,
              rating: 4.8,
              url_slug: 'carbone-new-york',
              availability: { slots: [{ config: { token: 'cfg1', type: 'Dining Room' }, date: { start: '2026-05-01T19:00:00' } }] },
            },
          ],
        },
      });

      const result = await harness.callTool('resy_search_venues', {
        query: 'carbone',
        date: '2026-05-01',
        party_size: 2,
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [method, path, body] = mockRequest.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/3/venuesearch/search');
      expect(body).toBeInstanceOf(URLSearchParams);
      const struct = JSON.parse((body as URLSearchParams).get('struct_data')!);
      expect(struct.slot_filter).toEqual({ day: '2026-05-01', party_size: 2 });
      expect(struct.per_page).toBe(20);
      expect(struct.geo.latitude).toBeCloseTo(40.7128);
      expect(struct.geo.longitude).toBeCloseTo(-73.9876);
      expect(struct.query).toBe('carbone');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"name": "Carbone"');
      expect(text).toContain('"venue_id": 101');
    });

    it('respects explicit lat/lng/limit', async () => {
      mockRequest.mockResolvedValue({ search: { hits: [] } });
      await harness.callTool('resy_search_venues', {
        date: '2026-05-01', party_size: 2,
        lat: 34.0522, lng: -118.2437, limit: 5,
      });
      const [, , body] = mockRequest.mock.calls[0];
      const struct = JSON.parse((body as URLSearchParams).get('struct_data')!);
      expect(struct.geo.latitude).toBeCloseTo(34.0522);
      expect(struct.geo.longitude).toBeCloseTo(-118.2437);
      expect(struct.per_page).toBe(5);
    });
  });

  describe('resy_find_slots', () => {
    it('GETs /4/find with query params and formats slots', async () => {
      mockRequest.mockResolvedValue({
        results: {
          venues: [{
            slots: [
              { config: { token: 'cfg-a', type: 'Dining Room' }, date: { start: '2026-05-01T19:00:00', end: '' } },
              { config: { token: 'cfg-b', type: 'Bar' },         date: { start: '2026-05-01T20:30:00', end: '' } },
            ],
          }],
        },
      });

      const result = await harness.callTool('resy_find_slots', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });

      const [method, path] = mockRequest.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toContain('/4/find?');
      expect(path).toContain('venue_id=101');
      expect(path).toContain('day=2026-05-01');
      expect(path).toContain('party_size=2');
      expect(path).toContain('lat=40.7128');
      expect(path).toContain('long=-73.9876');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"config_token": "cfg-a"');
      expect(text).toContain('"time": "19:00"');
      expect(text).toContain('"time": "20:30"');
    });

    it('returns empty array when venue has no slots', async () => {
      mockRequest.mockResolvedValue({ results: { venues: [] } });
      const result = await harness.callTool('resy_find_slots', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });
      const text = (result.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual([]);
    });
  });

  describe('resy_get_venue', () => {
    it('GETs /3/venue?id=<id>', async () => {
      mockRequest.mockResolvedValue({
        venue: {
          id: { resy: 101 }, name: 'Carbone',
          location: { locality: 'New York', region: 'NY' },
          cuisine: ['Italian'], price_range: 4,
          url_slug: 'carbone-new-york',
        },
      });

      const result = await harness.callTool('resy_get_venue', { venue_id: 101 });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/3/venue?id=101');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"name": "Carbone"');
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/venues.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/tools/venues.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

const DEFAULT_LAT = 40.7128;
const DEFAULT_LNG = -73.9876;
const DEFAULT_RADIUS_M = 16100;

interface RawSlot {
  config?: { token?: string; type?: string };
  date?: { start?: string; end?: string };
}
interface RawVenue {
  id?: { resy?: number };
  name?: string;
  location?: { locality?: string; region?: string; neighborhood?: string; url_slug?: string };
  cuisine?: string[];
  price_range?: number;
  rating?: number;
  url_slug?: string;
  availability?: { slots?: RawSlot[] };
  venue_url_slug?: string;
}

function formatSlot(raw: RawSlot, day: string, partySize: number) {
  const start = new Date(raw.date?.start ?? '');
  const hh = String(start.getHours()).padStart(2, '0');
  const mm = String(start.getMinutes()).padStart(2, '0');
  return {
    config_token: raw.config?.token ?? '',
    date: day,
    time: `${hh}:${mm}`,
    party_size: partySize,
    type: raw.config?.type ?? 'Dining Room',
  };
}

function formatVenue(raw: RawVenue, day?: string, partySize?: number) {
  const citySlug = (raw.location?.locality ?? 'new-york')
    .toLowerCase()
    .replace(/\s+/g, '-');
  const slug = raw.url_slug ?? raw.venue_url_slug ?? '';
  return {
    venue_id: raw.id?.resy,
    name: raw.name,
    location: raw.location
      ? {
          city: raw.location.locality,
          state: raw.location.region,
          neighborhood: raw.location.neighborhood,
        }
      : undefined,
    cuisine: raw.cuisine ?? [],
    price_range: raw.price_range,
    rating: raw.rating,
    url_slug: slug,
    url: slug ? `https://resy.com/cities/${citySlug}/${slug}` : undefined,
    slots:
      day !== undefined && partySize !== undefined
        ? (raw.availability?.slots ?? []).map((s) => formatSlot(s, day, partySize))
        : undefined,
  };
}

export function registerVenueTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_search_venues',
    {
      description:
        'Search Resy for restaurants with availability. Returns venues including any bookable slot tokens for the requested date + party size. Defaults to NYC geo if lat/lng omitted.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Venue name or keyword'),
        lat: z.number().optional().describe('Latitude (default 40.7128 NYC)'),
        lng: z.number().optional().describe('Longitude (default -73.9876 NYC)'),
        date: z.string().describe('Desired date YYYY-MM-DD'),
        party_size: z.number().int().positive().describe('Number of guests'),
        limit: z.number().int().positive().optional().describe('Max venues (default 20)'),
        radius_meters: z.number().int().positive().optional().describe('Search radius in meters (default 16100)'),
      },
    },
    async ({ query, lat, lng, date, party_size, limit, radius_meters }) => {
      const struct = {
        availability: true,
        page: 1,
        per_page: limit ?? 20,
        slot_filter: { day: date, party_size },
        types: ['venue'],
        order_by: 'availability',
        geo: {
          latitude: lat ?? DEFAULT_LAT,
          longitude: lng ?? DEFAULT_LNG,
          radius: radius_meters ?? DEFAULT_RADIUS_M,
        },
        query: query ?? '',
      };
      const body = new URLSearchParams({ struct_data: JSON.stringify(struct) });
      const data = await client.request<{ search?: { hits?: RawVenue[] } }>(
        'POST',
        '/3/venuesearch/search',
        body
      );
      const hits = data.search?.hits ?? [];
      const formatted = hits
        .filter((h) => h.id?.resy)
        .map((h) => formatVenue(h, date, party_size));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
      };
    }
  );

  server.registerTool(
    'resy_find_slots',
    {
      description:
        'List available reservation slots at a specific venue for a date + party size. Returns slot config_tokens suitable for booking. Tokens expire quickly; book soon after fetching.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      },
    },
    async ({ venue_id, date, party_size, lat, lng }) => {
      const params = new URLSearchParams({
        lat: String(lat ?? DEFAULT_LAT),
        long: String(lng ?? DEFAULT_LNG),
        day: date,
        party_size: String(party_size),
        venue_id: String(venue_id),
      });
      const data = await client.request<{
        results?: { venues?: Array<{ slots?: RawSlot[] }> };
      }>('GET', `/4/find?${params.toString()}`);
      const slots = data.results?.venues?.[0]?.slots ?? [];
      const formatted = slots.map((s) => formatSlot(s, date, party_size));
      return { content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_get_venue',
    {
      description: 'Get full details for a single Resy venue by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        venue_id: z.number().int().positive(),
      },
    },
    async ({ venue_id }) => {
      const data = await client.request<{ venue?: RawVenue }>(
        'GET',
        `/3/venue?id=${venue_id}`
      );
      const formatted = data.venue ? formatVenue(data.venue) : null;
      return { content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }] };
    }
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/venues.test.ts`
Expected: all passing (5 assertions + setup).

- [ ] **Step 5: Commit**

```bash
git add src/tools/venues.ts tests/tools/venues.test.ts
git commit -m "feat(tools): venue search, find-slots, get-venue"
```

---

## Task 9: Reservation tools — `resy_list_reservations` and `resy_cancel`

**Files:**
- Create: `src/tools/reservations.ts`
- Create: `tests/tools/reservations.test.ts`

The compound `resy_book` is added in Task 10 — keeping it separate because it has its own test scope.

- [ ] **Step 1: Write failing tests**

Write `tests/tools/reservations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerReservationTools } from '../../src/tools/reservations.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('reservation tools (list/cancel)', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerReservationTools(server, mockClient));
  });

  describe('resy_list_reservations', () => {
    it('GETs /3/user/reservations and normalises the payload', async () => {
      mockRequest.mockResolvedValue({
        reservations: [
          {
            resy_token: 'rr://abc',
            reservation_id: 777,
            venue: { name: 'Carbone' },
            date: '2026-05-01',
            time_slot: '19:00',
            num_seats: 2,
            config: { type: 'Dining Room' },
            status: 'confirmed',
          },
        ],
      });

      const result = await harness.callTool('resy_list_reservations');

      const [method, path] = mockRequest.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toContain('/3/user/reservations');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"venue_name": "Carbone"');
      expect(text).toContain('"reservation_id": 777');
      expect(text).toContain('"time": "19:00"');
      expect(text).toContain('"party_size": 2');
    });

    it('includes scope in query string', async () => {
      mockRequest.mockResolvedValue({ reservations: [] });
      await harness.callTool('resy_list_reservations', { scope: 'past' });
      const [, path] = mockRequest.mock.calls[0];
      expect(path).toContain('scope=past');
    });

    it('handles "upcoming" key in response instead of "reservations"', async () => {
      mockRequest.mockResolvedValue({
        upcoming: [
          { resy_token: 'rr://x', reservation_id: 1, venue: { name: 'X' }, date: '2026-05-01', time_slot: '18:00', num_seats: 2 },
        ],
      });
      const result = await harness.callTool('resy_list_reservations');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"venue_name": "X"');
    });
  });

  describe('resy_cancel', () => {
    it('POSTs /3/cancel form-encoded with resy_token', async () => {
      mockRequest.mockResolvedValue({ ok: true, status: 'cancelled', refund: 0 });
      const result = await harness.callTool('resy_cancel', { resy_token: 'rr://abc' });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [method, path, body] = mockRequest.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/3/cancel');
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('resy_token')).toBe('rr://abc');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled": true');
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/reservations.test.ts`
Expected: module not found.

- [ ] **Step 3: Write `src/tools/reservations.ts` (list + cancel only)**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface RawReservation {
  resy_token?: string;
  token?: string;
  reservation_id?: number;
  id?: number;
  venue?: { name?: string };
  venue_name?: string;
  name?: string;
  date?: string;
  day?: string;
  reservation_date?: string;
  time_slot?: string;
  time?: string;
  start_time?: string;
  num_seats?: number;
  party_size?: number;
  seats?: number;
  config?: { type?: string };
  type?: string;
  status?: string;
}

function formatReservation(r: RawReservation) {
  return {
    resy_token: r.resy_token ?? r.token ?? '',
    reservation_id: r.reservation_id ?? r.id ?? 0,
    venue_name: r.venue?.name ?? r.venue_name ?? r.name ?? 'Unknown',
    date: r.date ?? r.day ?? r.reservation_date ?? '',
    time: r.time_slot ?? r.time ?? r.start_time ?? '',
    party_size: r.num_seats ?? r.party_size ?? r.seats ?? 0,
    type: r.config?.type ?? r.type ?? 'Dining Room',
    status: r.status,
  };
}

export function registerReservationTools(
  server: McpServer,
  client: ResyClient
): void {
  server.registerTool(
    'resy_list_reservations',
    {
      description:
        'List the user\'s Resy reservations. Defaults to upcoming; pass scope="past" or scope="all" to broaden. Each result includes the resy_token needed for cancellation.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        scope: z.enum(['upcoming', 'past', 'all']).optional(),
      },
    },
    async ({ scope }) => {
      const scopeParam = scope ?? 'upcoming';
      const path = `/3/user/reservations?scope=${encodeURIComponent(scopeParam)}`;
      const data = await client.request<{
        reservations?: RawReservation[];
        upcoming?: RawReservation[];
        results?: RawReservation[];
      }>('GET', path);
      const raw = data.reservations ?? data.upcoming ?? data.results ?? [];
      const formatted = raw.map(formatReservation);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
      };
    }
  );

  server.registerTool(
    'resy_cancel',
    {
      description:
        'Cancel a Resy reservation by its resy_token (the rr://... identifier returned from resy_book or resy_list_reservations).',
      inputSchema: {
        resy_token: z.string().describe('rr://... reservation identifier'),
      },
    },
    async ({ resy_token }) => {
      const body = new URLSearchParams({ resy_token });
      const data = await client.request<Record<string, unknown>>(
        'POST',
        '/3/cancel',
        body
      );
      const result = { cancelled: true, raw: data };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/reservations.test.ts`
Expected: all passing (4 tests + setup).

- [ ] **Step 5: Commit**

```bash
git add src/tools/reservations.ts tests/tools/reservations.test.ts
git commit -m "feat(tools): list reservations and cancel"
```

---

## Task 10: Reservation tools — `resy_book` composite

**Files:**
- Modify: `src/tools/reservations.ts`
- Modify: `tests/tools/reservations.test.ts`

The composite tool orchestrates `/4/find → /3/details → /2/user → /3/book`. Tests verify the end-to-end flow via sequenced `mockRequest` responses.

- [ ] **Step 1: Append failing tests**

Add to `tests/tools/reservations.test.ts` inside the top-level `describe`:

```ts
  describe('resy_book', () => {
    function queueBookMocks(opts: {
      slots: Array<{ token: string; time: string; type?: string }>;
      bookToken?: string | null;
      venueName?: string;
      paymentMethods?: Array<{ id: number; is_default?: boolean }>;
      bookResponse?: Record<string, unknown>;
    }) {
      // /4/find
      mockRequest.mockResolvedValueOnce({
        results: {
          venues: [{
            slots: opts.slots.map((s) => ({
              config: { token: s.token, type: s.type ?? 'Dining Room' },
              date: { start: `2026-05-01T${s.time}:00`, end: '' },
            })),
          }],
        },
      });
      if (opts.bookToken !== null) {
        // /3/details
        mockRequest.mockResolvedValueOnce({
          book_token: { value: opts.bookToken ?? 'BK-1', date_expires: '' },
          venue: {
            name: opts.venueName ?? 'Carbone',
            venue_url_slug: 'carbone',
            location: { url_slug: 'new-york-ny' },
          },
          config: { type: 'Dining Room' },
        });
        // /2/user
        mockRequest.mockResolvedValueOnce({
          payment_methods: opts.paymentMethods ?? [{ id: 55, is_default: true }],
        });
        // /3/book
        mockRequest.mockResolvedValueOnce(
          opts.bookResponse ?? {
            resy_token: 'rr://new',
            reservation_id: 9001,
            date: '2026-05-01',
            time_slot: '19:00',
            num_seats: 2,
          }
        );
      }
    }

    it('runs the find→details→user→book sequence with default payment method', async () => {
      queueBookMocks({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
      });

      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      });

      expect(mockRequest).toHaveBeenCalledTimes(4);

      // find
      expect(mockRequest.mock.calls[0][0]).toBe('GET');
      expect(mockRequest.mock.calls[0][1]).toContain('/4/find?');

      // details
      expect(mockRequest.mock.calls[1][0]).toBe('GET');
      expect(mockRequest.mock.calls[1][1]).toContain('/3/details?');
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-7pm');

      // user
      expect(mockRequest.mock.calls[2]).toEqual(['GET', '/2/user']);

      // book
      const [bookMethod, bookPath, bookBody] = mockRequest.mock.calls[3];
      expect(bookMethod).toBe('POST');
      expect(bookPath).toBe('/3/book');
      expect(bookBody).toBeInstanceOf(URLSearchParams);
      const bb = bookBody as URLSearchParams;
      expect(bb.get('book_token')).toBe('BK-1');
      expect(JSON.parse(bb.get('struct_payment_method')!)).toEqual({ id: 55 });
      expect(bb.get('source_id')).toBe('resy.com-venue-details');

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"resy_token": "rr://new"');
      expect(text).toContain('"venue_url": "https://resy.com/cities/new-york-ny/carbone"');
    });

    it('picks the slot closest to desired_time when exact match missing', async () => {
      queueBookMocks({
        slots: [
          { token: 'cfg-630',  time: '18:30' },
          { token: 'cfg-730',  time: '19:30' },
        ],
      });
      await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:15',
      });
      // 19:30 is closer to 19:15 than 18:30
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-730');
    });

    it('uses explicit payment_method_id when provided and skips /2/user', async () => {
      mockRequest
        // find
        .mockResolvedValueOnce({
          results: { venues: [{ slots: [{ config: { token: 'cfg', type: 'DR' }, date: { start: '2026-05-01T19:00:00' } }] }] },
        })
        // details
        .mockResolvedValueOnce({
          book_token: { value: 'BK', date_expires: '' },
          venue: { name: 'X', venue_url_slug: 'x', location: { url_slug: 'c' } },
          config: { type: 'DR' },
        })
        // book
        .mockResolvedValueOnce({ resy_token: 'rr://', reservation_id: 1, time_slot: '19:00', num_seats: 2 });

      await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
        payment_method_id: 42,
      });

      expect(mockRequest).toHaveBeenCalledTimes(3); // no /2/user call
      const bb = mockRequest.mock.calls[2][2] as URLSearchParams;
      expect(JSON.parse(bb.get('struct_payment_method')!)).toEqual({ id: 42 });
    });

    it('throws when no slots are available', async () => {
      mockRequest.mockResolvedValueOnce({ results: { venues: [{ slots: [] }] } });
      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });
      expect(result.isError).toBeTruthy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/no available slots/i);
    });

    it('throws when user has no payment methods', async () => {
      queueBookMocks({ slots: [{ token: 'cfg', time: '19:00' }], paymentMethods: [] });
      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      });
      expect(result.isError).toBeTruthy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/no payment method on file/i);
    });
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/reservations.test.ts`
Expected: new tests fail — `resy_book` tool unknown.

- [ ] **Step 3: Append `registerReservationTools` body in `src/tools/reservations.ts`**

Add inside `registerReservationTools`, after the `resy_cancel` registration:

```ts
  server.registerTool(
    'resy_book',
    {
      description:
        'Book a reservation. Composite tool: internally runs find-slots → get booking details → book. Pass desired_time (HH:MM, 24-hour) to target a specific slot; otherwise the first available is used. Uses the user\'s default payment method unless payment_method_id is supplied.',
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        desired_time: z.string().optional().describe('HH:MM (24h)'),
        lat: z.number().optional(),
        lng: z.number().optional(),
        payment_method_id: z.number().int().positive().optional(),
      },
    },
    async ({ venue_id, date, party_size, desired_time, lat, lng, payment_method_id }) => {
      // 1. find fresh slots
      const findParams = new URLSearchParams({
        lat: String(lat ?? 40.7128),
        long: String(lng ?? -73.9876),
        day: date,
        party_size: String(party_size),
        venue_id: String(venue_id),
      });
      const findData = await client.request<{
        results?: { venues?: Array<{ slots?: Array<{ config?: { token?: string; type?: string }; date?: { start?: string } }> }> };
      }>('GET', `/4/find?${findParams.toString()}`);
      const rawSlots = findData.results?.venues?.[0]?.slots ?? [];
      if (rawSlots.length === 0) {
        throw new Error(
          'No available slots for this venue/date/party size. The restaurant may be fully booked.'
        );
      }

      // 2. pick a slot — exact match, else closest time, else first
      const slotsWithTime = rawSlots.map((s) => {
        const start = new Date(s.date?.start ?? '');
        const hh = String(start.getHours()).padStart(2, '0');
        const mm = String(start.getMinutes()).padStart(2, '0');
        const time = `${hh}:${mm}`;
        return { token: s.config?.token ?? '', type: s.config?.type ?? 'Dining Room', time };
      });
      const toMinutes = (t: string) => {
        const [h, m] = t.split(':').map((n) => Number(n));
        return h * 60 + (m || 0);
      };
      let chosen = slotsWithTime[0];
      if (desired_time) {
        const exact = slotsWithTime.find((s) => s.time === desired_time);
        if (exact) {
          chosen = exact;
        } else {
          const desired = toMinutes(desired_time);
          chosen = slotsWithTime.reduce((best, s) =>
            Math.abs(toMinutes(s.time) - desired) < Math.abs(toMinutes(best.time) - desired) ? s : best
          );
        }
      }

      // 3. get booking details for book_token
      const detailsParams = new URLSearchParams({
        config_id: chosen.token,
        day: date,
        party_size: String(party_size),
      });
      const details = await client.request<{
        book_token?: { value?: string };
        venue?: { name?: string; venue_url_slug?: string; location?: { url_slug?: string } };
        config?: { type?: string };
      }>('GET', `/3/details?${detailsParams.toString()}`);
      const bookToken = details.book_token?.value;
      if (!bookToken) {
        throw new Error('Resy did not return a book_token for this slot');
      }
      const venueName = details.venue?.name ?? 'Restaurant';
      const slotType = details.config?.type ?? chosen.type;
      const citySlug = details.venue?.location?.url_slug ?? 'new-york-ny';
      const venueSlug = details.venue?.venue_url_slug ?? '';
      const venueUrl = venueSlug
        ? `https://resy.com/cities/${citySlug}/${venueSlug}`
        : 'https://resy.com';

      // 4. resolve payment method
      let paymentId = payment_method_id;
      if (paymentId === undefined) {
        const user = await client.request<{
          payment_methods?: Array<{ id?: number; is_default?: boolean }>;
        }>('GET', '/2/user');
        const methods = user.payment_methods ?? [];
        const def = methods.find((m) => m.is_default) ?? methods[0];
        if (!def?.id) {
          throw new Error(
            'No payment method on file. Add one at resy.com/account before booking.'
          );
        }
        paymentId = def.id;
      }

      // 5. book
      const bookBody = new URLSearchParams({
        book_token: bookToken,
        struct_payment_method: JSON.stringify({ id: paymentId }),
        source_id: 'resy.com-venue-details',
      });
      const booked = await client.request<{
        resy_token?: string;
        reservation_id?: number;
        time_slot?: string;
        num_seats?: number;
      }>('POST', '/3/book', bookBody);

      const result = {
        resy_token: booked.resy_token,
        reservation_id: booked.reservation_id,
        venue_name: venueName,
        venue_url: venueUrl,
        date,
        time: booked.time_slot ?? chosen.time,
        party_size: booked.num_seats ?? party_size,
        type: slotType,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/reservations.test.ts`
Expected: all passing (9 tests + setup).

- [ ] **Step 5: Commit**

```bash
git add src/tools/reservations.ts tests/tools/reservations.test.ts
git commit -m "feat(tools): composite resy_book (find→details→user→book)"
```

---

## Task 11: Favorite tools — list / add / remove

**Files:**
- Create: `src/tools/favorites.ts`
- Create: `tests/tools/favorites.test.ts`

> Endpoint paths below are provisional (see spec "open questions"). The smoke script in Task 14 verifies live; adjust paths only if the smoke run falsifies them — do not alter tool shapes.

- [ ] **Step 1: Write failing tests**

Write `tests/tools/favorites.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerFavoriteTools } from '../../src/tools/favorites.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('favorite tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerFavoriteTools(server, mockClient));
  });

  it('resy_list_favorites GETs /3/user/favorites and returns an array', async () => {
    mockRequest.mockResolvedValue({
      favorites: [
        { id: { resy: 101 }, name: 'Carbone', url_slug: 'carbone' },
      ],
    });
    const result = await harness.callTool('resy_list_favorites');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/3/user/favorites');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"name": "Carbone"');
  });

  it('resy_add_favorite POSTs /3/user/favorites with venue_id', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const result = await harness.callTool('resy_add_favorite', { venue_id: 101 });
    const [method, path, body] = mockRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/3/user/favorites');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('venue_id')).toBe('101');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"favorited": true');
    expect(text).toContain('"venue_id": 101');
  });

  it('resy_remove_favorite DELETEs /3/user/favorites/<id>', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const result = await harness.callTool('resy_remove_favorite', { venue_id: 101 });
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/3/user/favorites/101');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"removed": true');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/favorites.test.ts`
Expected: module not found.

- [ ] **Step 3: Write `src/tools/favorites.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

export function registerFavoriteTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_favorites',
    {
      description: 'List the user\'s favorited Resy venues ("hit list").',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<Record<string, unknown>>('GET', '/3/user/favorites');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_add_favorite',
    {
      description: 'Add a venue to the user\'s favorites by venue_id.',
      inputSchema: { venue_id: z.number().int().positive() },
    },
    async ({ venue_id }) => {
      const body = new URLSearchParams({ venue_id: String(venue_id) });
      await client.request<unknown>('POST', '/3/user/favorites', body);
      const out = { favorited: true, venue_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_remove_favorite',
    {
      description: 'Remove a venue from the user\'s favorites by venue_id.',
      inputSchema: { venue_id: z.number().int().positive() },
    },
    async ({ venue_id }) => {
      await client.request<unknown>('DELETE', `/3/user/favorites/${venue_id}`);
      const out = { removed: true, venue_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/favorites.test.ts`
Expected: 3 passing + setup.

- [ ] **Step 5: Commit**

```bash
git add src/tools/favorites.ts tests/tools/favorites.test.ts
git commit -m "feat(tools): favorites list/add/remove"
```

---

## Task 12: Priority Notify tools — list / add / remove

**Files:**
- Create: `src/tools/notify.ts`
- Create: `tests/tools/notify.test.ts`

> Endpoint paths provisional — same caveat as favorites.

- [ ] **Step 1: Write failing tests**

Write `tests/tools/notify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerNotifyTools } from '../../src/tools/notify.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('notify tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerNotifyTools(server, mockClient));
  });

  it('resy_list_notify GETs /3/user/notify', async () => {
    mockRequest.mockResolvedValue({ notify: [{ id: 1, venue_id: 101 }] });
    const result = await harness.callTool('resy_list_notify');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/3/user/notify');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"venue_id": 101');
  });

  it('resy_add_notify POSTs /3/notify form-encoded', async () => {
    mockRequest.mockResolvedValue({ notify_id: 7 });
    const result = await harness.callTool('resy_add_notify', {
      venue_id: 101, date: '2026-05-01', party_size: 2, time_filter: '19:00-21:00',
    });
    const [method, path, body] = mockRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/3/notify');
    expect(body).toBeInstanceOf(URLSearchParams);
    const bb = body as URLSearchParams;
    expect(bb.get('venue_id')).toBe('101');
    expect(bb.get('day')).toBe('2026-05-01');
    expect(bb.get('party_size')).toBe('2');
    expect(bb.get('time_filter')).toBe('19:00-21:00');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"notify_id": 7');
  });

  it('resy_add_notify omits time_filter when absent', async () => {
    mockRequest.mockResolvedValue({ notify_id: 8 });
    await harness.callTool('resy_add_notify', {
      venue_id: 101, date: '2026-05-01', party_size: 2,
    });
    const bb = mockRequest.mock.calls[0][2] as URLSearchParams;
    expect(bb.has('time_filter')).toBe(false);
  });

  it('resy_remove_notify DELETEs /3/notify/<id>', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const result = await harness.callTool('resy_remove_notify', { notify_id: 7 });
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/3/notify/7');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"removed": true');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/notify.test.ts`
Expected: module not found.

- [ ] **Step 3: Write `src/tools/notify.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

export function registerNotifyTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_notify',
    {
      description:
        'List Priority Notify subscriptions — tables you are waiting for when reservations open up.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<unknown>('GET', '/3/user/notify');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_add_notify',
    {
      description:
        'Subscribe to Priority Notify for a venue/date/party size. Resy will email when a matching slot opens. time_filter is optional ("HH:MM-HH:MM" window).',
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        time_filter: z.string().optional().describe('HH:MM-HH:MM'),
      },
    },
    async ({ venue_id, date, party_size, time_filter }) => {
      const params: Record<string, string> = {
        venue_id: String(venue_id),
        day: date,
        party_size: String(party_size),
      };
      if (time_filter !== undefined) params.time_filter = time_filter;
      const body = new URLSearchParams(params);
      const data = await client.request<Record<string, unknown>>('POST', '/3/notify', body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_remove_notify',
    {
      description: 'Cancel a Priority Notify subscription by notify_id.',
      inputSchema: { notify_id: z.number().int().positive() },
    },
    async ({ notify_id }) => {
      await client.request<unknown>('DELETE', `/3/notify/${notify_id}`);
      const out = { removed: true, notify_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/tools/notify.test.ts`
Expected: 4 passing + setup.

- [ ] **Step 5: Commit**

```bash
git add src/tools/notify.ts tests/tools/notify.test.ts
git commit -m "feat(tools): priority notify list/add/remove"
```

---

## Task 13: MCP server bootstrap

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` with real bootstrap**

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ResyClient } from './client.js';
import { registerUserTools } from './tools/user.js';
import { registerVenueTools } from './tools/venues.js';
import { registerReservationTools } from './tools/reservations.js';
import { registerFavoriteTools } from './tools/favorites.js';
import { registerNotifyTools } from './tools/notify.js';

const client = new ResyClient();
const server = new McpServer({ name: 'resy-mcp', version: '0.1.0' });

registerUserTools(server, client);
registerVenueTools(server, client);
registerReservationTools(server, client);
registerFavoriteTools(server, client);
registerNotifyTools(server, client);

console.error(
  '[resy-mcp] This project was developed and is maintained by AI (Claude Opus 4.7). Use at your own discretion.'
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify full test suite still green**

Run: `npx vitest run`
Expected: all tests across the 6 test files pass.

- [ ] **Step 4: Verify bundler produces a working bundle**

Run: `npm run build`
Expected: `dist/bundle.js` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP server bootstrap wiring all tool registrations"
```

---

## Task 14: Smoke script for live endpoint verification

**Files:**
- Create: `scripts/smoke.ts`

This script is for the author to run once against real Resy to confirm favorites/notify/list-reservations endpoint shapes. It is *not* part of CI; it expects valid credentials in `.env`. If an endpoint returns a different shape or path, adjust the corresponding tool and its test before shipping.

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Manual smoke test: hits each tool against real Resy using .env credentials.
 * Run: npm run smoke
 *
 * Read-only operations only — no booking, no cancellation, no favoriting.
 */
import 'dotenv/config';
import { ResyClient } from '../src/client.js';

interface Probe {
  name: string;
  run: (client: ResyClient) => Promise<unknown>;
}

const probes: Probe[] = [
  { name: 'GET /2/user',                run: (c) => c.request('GET', '/2/user') },
  { name: 'GET /3/user/reservations',   run: (c) => c.request('GET', '/3/user/reservations?scope=upcoming') },
  { name: 'GET /3/user/favorites',      run: (c) => c.request('GET', '/3/user/favorites') },
  { name: 'GET /3/user/notify',         run: (c) => c.request('GET', '/3/user/notify') },
];

const client = new ResyClient();

for (const probe of probes) {
  const label = probe.name.padEnd(34);
  try {
    const data = await probe.run(client);
    const preview = JSON.stringify(data).slice(0, 160);
    console.log(`✓ ${label} ${preview}${preview.length === 160 ? '…' : ''}`);
  } catch (err) {
    console.log(`✗ ${label} ${(err as Error).message}`);
  }
}
```

- [ ] **Step 2: Commit (do not run yet — requires real creds)**

```bash
git add scripts/smoke.ts
git commit -m "chore: smoke script for live endpoint verification"
```

- [ ] **Step 3: (Optional, manual) run against real account**

With a populated `.env`:

Run: `npm run smoke`

For each `✗` line, investigate whether the path differs from the provisional one used in `favorites.ts` / `notify.ts` / `reservations.ts`. If a path needs to change, update the source and the corresponding test assertion, then re-run `npx vitest run` and `npm run smoke` to confirm.

---

## Task 15: MCPB manifest

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/anthropics/dxt/main/dist/mcpb-manifest.schema.json",
  "manifest_version": "0.3",
  "name": "resy-mcp",
  "display_name": "Resy",
  "version": "0.1.0",
  "description": "Resy reservation management for Claude — search venues, book tables, manage reservations and priority notify",
  "author": {
    "name": "Chris Chall",
    "email": "chris.c.hall@gmail.com",
    "url": "https://github.com/chrischall"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/chrischall/resy-mcp"
  },
  "homepage": "https://github.com/chrischall/resy-mcp",
  "support": "https://github.com/chrischall/resy-mcp/issues",
  "license": "MIT",
  "keywords": [
    "resy",
    "reservations",
    "restaurants",
    "dining",
    "booking"
  ],
  "server": {
    "type": "node",
    "entry_point": "dist/bundle.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/bundle.js"],
      "env": {
        "RESY_EMAIL": "${user_config.resy_email}",
        "RESY_PASSWORD": "${user_config.resy_password}"
      }
    }
  },
  "user_config": {
    "resy_email": {
      "type": "string",
      "title": "Resy Email",
      "description": "Your Resy account email",
      "required": true
    },
    "resy_password": {
      "type": "string",
      "title": "Resy Password",
      "description": "Your Resy account password",
      "required": true,
      "sensitive": true
    }
  },
  "tools": [
    { "name": "resy_get_profile",        "description": "Get the authenticated Resy user's profile" },
    { "name": "resy_search_venues",      "description": "Search venues with availability" },
    { "name": "resy_find_slots",         "description": "List available reservation slots at a venue" },
    { "name": "resy_get_venue",          "description": "Get full venue details by id" },
    { "name": "resy_book",               "description": "Book a reservation (composite: find→details→book)" },
    { "name": "resy_list_reservations",  "description": "List upcoming/past reservations" },
    { "name": "resy_cancel",             "description": "Cancel a reservation by resy_token" },
    { "name": "resy_list_favorites",     "description": "List favorited venues" },
    { "name": "resy_add_favorite",       "description": "Add a venue to favorites" },
    { "name": "resy_remove_favorite",    "description": "Remove a venue from favorites" },
    { "name": "resy_list_notify",        "description": "List Priority Notify subscriptions" },
    { "name": "resy_add_notify",         "description": "Subscribe to Priority Notify" },
    { "name": "resy_remove_notify",      "description": "Cancel a Priority Notify subscription" }
  ],
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=18.0.0" }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "feat: MCPB manifest with user_config credentials"
```

---

## Task 16: Documentation

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write `README.md`**

```md
# resy-mcp

Resy reservation management as an MCP server for Claude — search restaurants, book tables, manage reservations, favorites, and Priority Notify via natural language.

> ⚠️ Resy does not publish an official API. This server uses the same private endpoints the Resy web app calls, with the public web-app `api_key` and user-level auth via email + password. Use at your own discretion.

## Tools

| Tool | Purpose |
| --- | --- |
| `resy_get_profile` | Current user profile (name, email, booking count) |
| `resy_search_venues` | Search venues with availability for a date + party size |
| `resy_find_slots` | List bookable slots at a venue |
| `resy_get_venue` | Full venue details |
| `resy_book` | Book a reservation (composite: find → details → book) |
| `resy_list_reservations` | Upcoming / past reservations |
| `resy_cancel` | Cancel by `resy_token` |
| `resy_list_favorites` | Favorited venues |
| `resy_add_favorite` / `resy_remove_favorite` | Manage favorites |
| `resy_list_notify` | Priority Notify subscriptions |
| `resy_add_notify` / `resy_remove_notify` | Manage Priority Notify |

## Install

```bash
npm install
npm run build
```

## Configure

Copy `.env.example` to `.env` and fill in:

```
RESY_EMAIL=you@example.com
RESY_PASSWORD=changeme
```

For MCPB / Claude Desktop install, the packaged manifest prompts for `Resy Email` and `Resy Password` at configure time.

## Run (local stdio)

```bash
node dist/bundle.js
```

## Test

```bash
npm test             # unit tests (mocked fetch)
npm run smoke        # live endpoint probe — requires real .env
```

## Notes

- The `RESY_API_KEY` used by the client is the public key baked into resy.com's JS bundle. If Resy rotates it, set `RESY_API_KEY` in your environment to override.
- Favorites and Priority Notify endpoint paths are reverse-engineered; if live endpoints differ, run `npm run smoke` and adjust.

---

This project was developed and is maintained by AI (Claude Opus 4.7).
```

- [ ] **Step 2: Write `CLAUDE.md`**

```md
# CLAUDE.md — resy-mcp

Guidance for Claude working in this repo.

## Commands

- `npm test` — vitest, mocked fetch, no network.
- `npm run build` — tsc + esbuild bundle to `dist/bundle.js`.
- `npm run smoke` — live probe of `/2/user`, `/3/user/reservations`, `/3/user/favorites`, `/3/user/notify` using `.env`.
- `npx tsc --noEmit` — typecheck only.

## Layout

- `src/client.ts` — `ResyClient`: lazy login, token caching, 401/419 re-login+retry, 429 backoff+retry, auth-like 500 handling.
- `src/tools/*.ts` — one file per concern (user / venues / reservations / favorites / notify). Each exports a `registerXxxTools(server, client)` function.
- `src/index.ts` — MCP bootstrap; wires tool registrations over stdio.
- `tests/` — 1:1 mirror of `src/`, plus `tests/helpers.ts` for in-memory MCP test harness.

## Conventions

- All tools are `resy_*`-prefixed.
- Tool return shape: `{ content: [{ type: 'text', text: JSON.stringify(..., null, 2) }] }`.
- Readonly tools set `annotations: { readOnlyHint: true }`.
- Prefer `URLSearchParams` for form-encoded bodies; the client detects `body instanceof URLSearchParams` and sets `Content-Type: application/x-www-form-urlencoded`.
- Write a failing test before implementation. Keep tests in `tests/tools/<name>.test.ts` and mock `ResyClient.request`.

## Known unknowns

Paths for `favorites` and `notify` are provisional. `resy_list_reservations` accepts a `scope` query param that has not been verified against live Resy. See `scripts/smoke.ts` and the "open questions" block in `docs/superpowers/specs/2026-04-19-resy-mcp-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README and CLAUDE.md"
```

---

## Task 17: Final verification

**Files:** none — this is a green-light check.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: 6 test files all passing. No skipped.

- [ ] **Step 2: Coverage sanity check**

Run: `npm run test:coverage`
Expected: `src/client.ts` and each `src/tools/*.ts` ≥ 80 % line coverage.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Bundle build**

Run: `npm run build`
Expected: `dist/bundle.js` exists, no errors.

- [ ] **Step 5: Manual sanity — bundle starts without crashing**

Run: `RESY_EMAIL=dummy RESY_PASSWORD=dummy node dist/bundle.js < /dev/null`
Expected: process writes the `[resy-mcp] This project was developed and is maintained by AI…` stderr line, then exits 0 (stdin closed by `/dev/null` ends the MCP transport cleanly).

- [ ] **Step 6: (Optional) live smoke**

Only with real credentials in `.env`:

Run: `npm run smoke`
Expected: ✓ for each of `/2/user`, `/3/user/reservations`, `/3/user/favorites`, `/3/user/notify`.

If any probe fails, follow the Task 14 Step 3 adjustment loop: update the tool source + test, re-run both `npx vitest run` and `npm run smoke`.

- [ ] **Step 7: Commit any adjustments from smoke (if any)**

```bash
git add -A
git commit -m "fix: endpoint path adjustments from live smoke"
```
