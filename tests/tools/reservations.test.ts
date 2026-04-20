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

    it('reports cancelled=false when Resy returns an explicit failure body', async () => {
      mockRequest.mockResolvedValue({ ok: false, error: 'past deadline' });
      const result = await harness.callTool('resy_cancel', { resy_token: 'rr://late' });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled": false');
      expect(text).toContain('"error": "past deadline"');
    });

    it('reports cancelled=false on a fail-shaped status string', async () => {
      mockRequest.mockResolvedValue({ status: 'failed' });
      const result = await harness.callTool('resy_cancel', { resy_token: 'rr://x' });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled": false');
    });
  });

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

    it('rejects malformed desired_time with a clear validation error', async () => {
      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '7pm',
      });
      expect(result.isError).toBeTruthy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/desired_time/i);
      // Schema failed → no backend calls made
      expect(mockRequest).not.toHaveBeenCalled();
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
});
