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

  it('resy_list_notify GETs /3/notify and flattens specs', async () => {
    // Verified shape (live smoke 2026-04-20):
    //   { notify: [ { specs: { venue_id, day, party_size, notify_request_id,
    //                          time_preferred_start, time_preferred_end, service_type_id }, ... } ] }
    mockRequest.mockResolvedValue({
      notify: [
        {
          specs: {
            venue_id: 2747,
            day: '2026-04-24',
            party_size: 2,
            notify_request_id: 127233046,
            time_preferred_start: '18:00:00',
            time_preferred_end: '20:30:00',
            service_type_id: 2,
          },
          results: { venues: [] },
        },
        // Entry missing notify_request_id should be dropped defensively.
        { specs: { venue_id: 999, day: '2026-04-25', party_size: 2 } },
      ],
    });
    const result = await harness.callTool('resy_list_notify');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/3/notify');

    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      notify_id: 127233046,
      venue_id: 2747,
      date: '2026-04-24',
      party_size: 2,
      time_start: '18:00',
      time_end: '20:30',
      service_type_id: 2,
    });
  });

  it('resy_list_notify returns [] when user has no subscriptions', async () => {
    mockRequest.mockResolvedValue({ notify: [] });
    const result = await harness.callTool('resy_list_notify');
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual([]);
  });

  it('resy_add_notify POSTs /2/notify with num_seats (NOT party_size) and HH:MM:SS times', async () => {
    // Verified via live smoke: Resy's write endpoint is /2/notify, not /3/notify,
    // and the field name is num_seats, not party_size.
    mockRequest.mockResolvedValue({ notify_id: 7 });
    const result = await harness.callTool('resy_add_notify', {
      venue_id: 101, date: '2026-05-01', party_size: 2,
      time_start: '19:00', time_end: '21:00',
    });
    const [method, path, body] = mockRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/2/notify');
    expect(body).toBeInstanceOf(URLSearchParams);
    const bb = body as URLSearchParams;
    expect(bb.get('venue_id')).toBe('101');
    expect(bb.get('day')).toBe('2026-05-01');
    expect(bb.get('num_seats')).toBe('2');
    expect(bb.has('party_size')).toBe(false); // MUST not use party_size
    expect(bb.get('time_preferred_start')).toBe('19:00:00');
    expect(bb.get('time_preferred_end')).toBe('21:00:00');
    expect(bb.get('service_type_id')).toBe('2');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"notify_id": 7');
  });

  it('resy_add_notify defaults time window to 18:00–21:00 and service_type_id to 2', async () => {
    mockRequest.mockResolvedValue({ notify_id: 8 });
    await harness.callTool('resy_add_notify', {
      venue_id: 101, date: '2026-05-01', party_size: 2,
    });
    const bb = mockRequest.mock.calls[0][2] as URLSearchParams;
    expect(bb.get('time_preferred_start')).toBe('18:00:00');
    expect(bb.get('time_preferred_end')).toBe('21:00:00');
    expect(bb.get('service_type_id')).toBe('2');
  });

  it('resy_add_notify rejects malformed times at schema layer', async () => {
    const result = await harness.callTool('resy_add_notify', {
      venue_id: 101, date: '2026-05-01', party_size: 2, time_start: '7pm',
    });
    expect(result.isError).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('resy_remove_notify looks up the spec then DELETEs /2/notify with full query', async () => {
    // Verified via live smoke: Resy's DELETE requires the full spec in the query string,
    // not just the id in the path.
    mockRequest
      // First call: list (to look up the spec)
      .mockResolvedValueOnce({
        notify: [{
          specs: {
            venue_id: 2747, day: '2026-04-24', party_size: 2,
            notify_request_id: 127233046, service_type_id: 2,
            time_preferred_start: '18:00:00', time_preferred_end: '20:30:00',
          },
        }],
      })
      // Second call: delete
      .mockResolvedValueOnce(null);

    const result = await harness.callTool('resy_remove_notify', { notify_id: 127233046 });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[0]).toEqual(['GET', '/3/notify']);

    const [method, path] = mockRequest.mock.calls[1];
    expect(method).toBe('DELETE');
    expect(path).toContain('/2/notify?');
    expect(path).toContain('notify_request_id=127233046');
    expect(path).toContain('venue_id=2747');
    expect(path).toContain('day=2026-04-24');
    expect(path).toContain('num_seats=2');
    expect(path).toContain('service_type_id=2');

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"removed": true');
    expect(text).toContain('"notify_id": 127233046');
  });

  it('resy_remove_notify throws when notify_id is not in the user\'s list', async () => {
    mockRequest.mockResolvedValueOnce({ notify: [] });
    const result = await harness.callTool('resy_remove_notify', { notify_id: 999999 });
    expect(result.isError).toBeTruthy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/no priority notify subscription found/i);
  });
});
