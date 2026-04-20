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
