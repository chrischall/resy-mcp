import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import type { ResyClient } from '../src/client.js';

interface Result {
  ok: boolean;
  credential: { source: string | null; resolved: boolean };
  error?: { kind: string; message: string };
  hint: string;
}

function clientWith(source: string | null, probe: () => Promise<unknown>): ResyClient {
  return { describeCredential: () => ({ source }), request: probe } as unknown as ResyClient;
}

async function call(client: ResyClient) {
  const h = await createTestHarness((server) => registerHealthcheckTools(server, client));
  const res = await h.client.callTool({ name: 'resy_healthcheck', arguments: {} });
  await h.close?.();
  return parseToolResult<Result>(res as never);
}

describe('resy_healthcheck', () => {
  it('names the configured mint path', async () => {
    const r = await call(clientWith('fetchproxy', async () => ({ em_address: 'a@b.c' })));
    expect(r.ok).toBe(true);
    expect(r.credential).toMatchObject({ source: 'fetchproxy', resolved: true });
  });

  it('reports no_credential, naming all three paths, when none is configured', async () => {
    const r = await call(clientWith(null, async () => ({})));
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('no_credential');
    expect(r.hint).toMatch(/RESY_EMAIL/);
    expect(r.hint).toMatch(/RESY_AUTH_TOKEN/);
    expect(r.hint).toMatch(/resy\.com/);
  });

  // A configured-but-broken path must read as a REJECTION, not as "not
  // configured" — they have completely different fixes.
  it('distinguishes a configured-but-rejected path from an unconfigured one', async () => {
    const r = await call(
      clientWith('password login', async () => {
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }),
    );
    expect(r.error?.kind).toBe('credential_rejected');
    expect(r.hint).toMatch(/RESY_EMAIL|resy\.com/);
  });

  it('keeps a Resy-side failure distinct', async () => {
    const r = await call(
      clientWith('env token (RESY_AUTH_TOKEN)', async () => {
        throw Object.assign(new Error('Bad gateway'), { status: 502 });
      }),
    );
    expect(r.error?.kind).toBe('http');
  });

  // Minting performs a real password login or opens the bridge; reporting
  // configuration must not spend either.
  it('does not probe when nothing is configured', async () => {
    const probe = vi.fn(async () => ({}));
    await call(clientWith(null, probe));
    expect(probe).not.toHaveBeenCalled();
  });

  it('never reports a token', async () => {
    const r = await call(clientWith('env token (RESY_AUTH_TOKEN)', async () => ({})));
    expect(JSON.stringify(r)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
});
