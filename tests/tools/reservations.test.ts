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
    // Real Resy shape (verified via live smoke 2026-04-20):
    //   { reservations: [...], venues: { "<id>": {...name} } }
    // Each reservation has venue = { id: <number> }; the name lives in the
    // top-level venues map keyed by the venue id as a string.

    const FAR_FUTURE = '2099-12-31';
    const FAR_PAST = '2000-01-01';

    function mockPayload(rez: Array<{
      resy_token: string;
      reservation_id: number;
      venue_id: number;
      day: string;
      time_slot?: string;
      num_seats?: number;
      type?: string;
      occasion?: string | null;
      special_request?: string | null;
      cancellable?: boolean;
      cancellation_fee?: { amount: number; applies: boolean };
    }>, venues: Record<string, { name: string }>) {
      mockRequest.mockResolvedValue({
        reservations: rez.map((r) => ({
          resy_token: r.resy_token,
          reservation_id: r.reservation_id,
          venue: { id: r.venue_id },
          day: r.day,
          time_slot: r.time_slot ?? '19:00:00',
          num_seats: r.num_seats ?? 2,
          config: { type: r.type ?? 'Dining Room' },
          occasion: r.occasion ?? null,
          special_request: r.special_request ?? null,
          cancellation: {
            allowed: r.cancellable ?? true,
            fee: r.cancellation_fee,
          },
        })),
        venues,
      });
    }

    it('joins venue_name from the venues lookup keyed by stringified id', async () => {
      mockPayload(
        [{ resy_token: 'rr://a', reservation_id: 777, venue_id: 552, day: FAR_FUTURE }],
        { '552': { name: 'The Ordinary' } }
      );

      const result = await harness.callTool('resy_list_reservations');

      const [method, path] = mockRequest.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toBe('/3/user/reservations'); // no scope query — filtering is client-side

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].venue_name).toBe('The Ordinary');
      expect(parsed[0].venue_id).toBe(552);
    });

    it('falls back to "Unknown" when venues lookup is missing', async () => {
      mockPayload(
        [{ resy_token: 'rr://a', reservation_id: 1, venue_id: 999, day: FAR_FUTURE }],
        {}
      );
      const result = await harness.callTool('resy_list_reservations');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].venue_name).toBe('Unknown');
    });

    it('trims seconds from time_slot (19:30:00 → 19:30)', async () => {
      mockPayload(
        [{ resy_token: 'rr://a', reservation_id: 1, venue_id: 1, day: FAR_FUTURE, time_slot: '19:30:00' }],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].time).toBe('19:30');
    });

    it('surfaces occasion, special_request, cancellable, and cancellation_fee when applicable', async () => {
      mockPayload(
        [{
          resy_token: 'rr://a', reservation_id: 1, venue_id: 1, day: FAR_FUTURE,
          occasion: 'Anniversary',
          special_request: '6 months til our wedding',
          cancellable: true,
          cancellation_fee: { amount: 25, applies: true },
        }],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0].occasion).toBe('Anniversary');
      expect(parsed[0].special_request).toBe('6 months til our wedding');
      expect(parsed[0].cancellable).toBe(true);
      expect(parsed[0].cancellation_fee).toBe(25);
    });

    it('omits cancellation_fee when fee.applies=false', async () => {
      mockPayload(
        [{
          resy_token: 'rr://a', reservation_id: 1, venue_id: 1, day: FAR_FUTURE,
          cancellation_fee: { amount: 25, applies: false },
        }],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed[0]).not.toHaveProperty('cancellation_fee');
    });

    it('default scope "upcoming" filters to reservations on or after today (client-side)', async () => {
      // Resy returns the FULL list (it ignores the scope param); the tool
      // has to filter locally.
      mockPayload(
        [
          { resy_token: 'rr://future',  reservation_id: 1, venue_id: 1, day: FAR_FUTURE },
          { resy_token: 'rr://past',    reservation_id: 2, venue_id: 1, day: FAR_PAST },
        ],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations');
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].resy_token).toBe('rr://future');
    });

    it('scope="past" returns only before-today reservations', async () => {
      mockPayload(
        [
          { resy_token: 'rr://future', reservation_id: 1, venue_id: 1, day: FAR_FUTURE },
          { resy_token: 'rr://past',   reservation_id: 2, venue_id: 1, day: FAR_PAST },
        ],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations', { scope: 'past' });
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].resy_token).toBe('rr://past');
    });

    it('scope="all" returns every reservation', async () => {
      mockPayload(
        [
          { resy_token: 'rr://future', reservation_id: 1, venue_id: 1, day: FAR_FUTURE },
          { resy_token: 'rr://past',   reservation_id: 2, venue_id: 1, day: FAR_PAST },
        ],
        { '1': { name: 'X' } }
      );
      const result = await harness.callTool('resy_list_reservations', { scope: 'all' });
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed).toHaveLength(2);
    });

    it('does not pass scope in the query string (Resy ignores it)', async () => {
      mockPayload([], {});
      await harness.callTool('resy_list_reservations', { scope: 'past' });
      const [, path] = mockRequest.mock.calls[0];
      expect(path).toBe('/3/user/reservations');
      expect(path).not.toContain('scope=');
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
        .mockResolvedValueOnce({
          results: { venues: [{ slots: [{ config: { token: 'cfg', type: 'DR' }, date: { start: '2026-05-01T19:00:00' } }] }] },
        })
        .mockResolvedValueOnce({
          book_token: { value: 'BK', date_expires: '' },
          venue: { name: 'X', venue_url_slug: 'x', location: { url_slug: 'c' } },
          config: { type: 'DR' },
        })
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
