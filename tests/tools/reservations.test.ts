import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { bookingTermsToken, registerReservationTools } from '../../src/tools/reservations.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
// mockReset (not just clearAllMocks) drains any leftover mockResolvedValueOnce
// queue between tests — the confirm-gate preview paths consume fewer calls than
// a full book sequence, so an undrained queue would leak into the next test.
beforeEach(() => {
  vi.clearAllMocks();
  mockRequest.mockReset();
});
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

    // fleet-audit#228: "today" must not be the SERVER's local date. Hosted, the
    // process runs in UTC — at 20:30 EDT on Sep 23 it is already Sep 24 there,
    // and tonight's booking fell into "past" (and out of the default list,
    // taking its resy_token with it).
    describe('today boundary is timezone-independent', () => {
      afterEach(() => { vi.useRealTimers(); });

      it('keeps tonight\'s booking "upcoming" when UTC has already rolled to tomorrow', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 2026-09-24T00:30Z == 20:30 EDT on 2026-09-23.
        vi.setSystemTime(new Date('2026-09-24T00:30:00Z'));
        mockPayload(
          [{ resy_token: 'rr://tonight', reservation_id: 1, venue_id: 1, day: '2026-09-23', time_slot: '21:00:00' }],
          { '1': { name: 'X' } }
        );
        const upcoming = JSON.parse(
          ((await harness.callTool('resy_list_reservations')).content[0] as { text: string }).text
        );
        expect(upcoming.map((r: { resy_token: string }) => r.resy_token)).toEqual(['rr://tonight']);

        const past = JSON.parse(
          ((await harness.callTool('resy_list_reservations', { scope: 'past' })).content[0] as { text: string }).text
        );
        expect(past).toEqual([]);
      });

      it('moves a day into "past" once that date has ended everywhere', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 2026-09-24T13:00Z: 2026-09-23 is over in every timezone (UTC-12 is at 01:00 on the 24th).
        vi.setSystemTime(new Date('2026-09-24T13:00:00Z'));
        mockPayload(
          [
            { resy_token: 'rr://yesterday', reservation_id: 1, venue_id: 1, day: '2026-09-23' },
            { resy_token: 'rr://today', reservation_id: 2, venue_id: 1, day: '2026-09-24' },
          ],
          { '1': { name: 'X' } }
        );
        const upcoming = JSON.parse(
          ((await harness.callTool('resy_list_reservations')).content[0] as { text: string }).text
        );
        expect(upcoming.map((r: { resy_token: string }) => r.resy_token)).toEqual(['rr://today']);
      });
    });

    it('does not pass scope in the query string (Resy ignores it)', async () => {
      mockPayload([], {});
      await harness.callTool('resy_list_reservations', { scope: 'past' });
      const [, path] = mockRequest.mock.calls[0];
      expect(path).toBe('/3/user/reservations');
      expect(path).not.toContain('scope=');
    });
  });


  // ─── confirmation plumbing ──────────────────────────────────────────
  // `harness` has no elicitation handler: it is a client that cannot be
  // prompted, so under the default MCP_CONFIRM_MODE (ask-user) every write
  // runs the two-step token flow. Phase 1 returns a preview and a
  // confirmToken and does nothing; phase 2 (same args + token) writes.
  const SAVED_CONFIRM_MODE = process.env.MCP_CONFIRM_MODE;
  beforeEach(() => { delete process.env.MCP_CONFIRM_MODE; });
  afterEach(() => {
    if (SAVED_CONFIRM_MODE === undefined) delete process.env.MCP_CONFIRM_MODE;
    else process.env.MCP_CONFIRM_MODE = SAVED_CONFIRM_MODE;
  });

  function parse(result: { content: unknown[] }): any {
    return JSON.parse((result.content[0] as { text: string }).text);
  }

  /** Phase 1, then phase 2 with the token phase 1 returned. */
  async function confirmed(name: string, args: Record<string, unknown>) {
    const first = parse(await harness.callTool(name, args));
    expect(first.status).toBe('confirmation-required');
    expect(typeof first.confirmToken).toBe('string');
    const result = await harness.callTool(name, { ...args, confirmToken: first.confirmToken });
    return { first, result };
  }

  /** A harness whose client CAN be prompted, answering every prompt with `action`. */
  function promptingHarness(action: 'accept' | 'decline') {
    return createTestHarness((server) => registerReservationTools(server, mockClient), {
      elicitation: async () =>
        action === 'accept' ? { action: 'accept', content: { confirmed: true } } : { action: 'decline' },
    });
  }

  const posts = (path: string) => mockRequest.mock.calls.filter((c) => c[0] === 'POST' && c[1] === path);

  describe('resy_cancel', () => {
    const LISTING = {
      reservations: [
        {
          resy_token: 'rr://abc',
          reservation_id: 42,
          venue: { id: 1 },
          day: '2099-12-31',
          time_slot: '19:30:00',
          num_seats: 4,
          config: { type: 'Dining Room' },
          cancellation: { allowed: true, fee: { amount: 25, applies: true } },
        },
      ],
      venues: { '1': { name: 'The Ordinary' } },
    };

    /** Route GET /3/user/reservations and POST /3/cancel by path. */
    function routeCancel(
      listing: unknown | (() => unknown),
      cancelResponse: Record<string, unknown> = { ok: true, status: 'cancelled', refund: 0 }
    ) {
      mockRequest.mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path === '/3/user/reservations') {
          return typeof listing === 'function' ? (listing as () => unknown)() : listing;
        }
        if (method === 'POST' && path === '/3/cancel') return cancelResponse;
        throw new Error(`unexpected ${method} ${path}`);
      });
    }

    it('phase 2 with the confirmToken POSTs /3/cancel form-encoded with resy_token, exactly once', async () => {
      routeCancel(LISTING);
      const { result } = await confirmed('resy_cancel', { resy_token: 'rr://abc' });

      expect(posts('/3/cancel')).toHaveLength(1);
      const [, , body] = posts('/3/cancel')[0];
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('resy_token')).toBe('rr://abc');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled":true');
    });

    it('reports cancelled=false when Resy returns an explicit failure body', async () => {
      routeCancel(LISTING, { ok: false, error: 'past deadline' });
      const { result } = await confirmed('resy_cancel', { resy_token: 'rr://abc' });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled":false');
      expect(text).toContain('"error":"past deadline"');
    });

    it('reports cancelled=false on a fail-shaped status string', async () => {
      routeCancel(LISTING, { status: 'failed' });
      const { result } = await confirmed('resy_cancel', { resy_token: 'rr://abc' });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"cancelled":false');
    });

    it('phase 1 returns confirmation-required with the preview and makes NO /3/cancel call', async () => {
      routeCancel(LISTING);
      const parsed = parse(await harness.callTool('resy_cancel', { resy_token: 'rr://abc' }));

      // Only the read happened — never POST /3/cancel.
      expect(mockRequest.mock.calls).toEqual([['GET', '/3/user/reservations']]);
      expect(posts('/3/cancel')).toHaveLength(0);

      expect(parsed.status).toBe('confirmation-required');
      expect(parsed.action).toBe('resy.cancel');
      expect(parsed.preview.cancelled).toBe(false);
      expect(parsed.preview.resy_token).toBe('rr://abc');
      expect(parsed.preview.venue_name).toBe('The Ordinary');
      expect(parsed.preview.date).toBe('2099-12-31');
      expect(parsed.preview.time).toBe('19:30');
      expect(parsed.preview.party_size).toBe(4);
      expect(parsed.preview.cancellable).toBe(true);
      expect(parsed.preview.cancellation_fee).toBe(25);
      expect(parsed.preview.note).toMatch(/cancellation fee of 25/i);
    });

    it('phase 1 still previews (no crash) when the resy_token is not found, and phase 2 attempts the cancel anyway', async () => {
      routeCancel({ reservations: [], venues: {} });
      const { first } = await confirmed('resy_cancel', { resy_token: 'rr://ghost' });
      expect(first.preview.cancelled).toBe(false);
      expect(first.preview.note).toMatch(/not found/i);
      expect(first.preview).not.toHaveProperty('venue_name');
      expect(posts('/3/cancel')).toHaveLength(1);
    });

    it('replaying a used confirmToken is refused as TOKEN_REUSED and cancels nothing more', async () => {
      routeCancel(LISTING);
      const { first } = await confirmed('resy_cancel', { resy_token: 'rr://abc' });
      expect(posts('/3/cancel')).toHaveLength(1);

      const replay = await harness.callTool('resy_cancel', { resy_token: 'rr://abc', confirmToken: first.confirmToken });
      expect(replay.isError).toBe(true);
      expect(parse(replay).error).toBe('TOKEN_REUSED');
      expect(posts('/3/cancel')).toHaveLength(1);
    });

    it('refuses as DRAFT_CHANGED when the reservation changed between the phases (a fee appeared)', async () => {
      let fee: { amount: number; applies: boolean } | undefined;
      routeCancel(() => ({
        ...LISTING,
        reservations: [{ ...LISTING.reservations[0], cancellation: { allowed: true, fee } }],
      }));
      const first = parse(await harness.callTool('resy_cancel', { resy_token: 'rr://abc' }));
      expect(first.preview).not.toHaveProperty('cancellation_fee');

      fee = { amount: 50, applies: true };
      const second = await harness.callTool('resy_cancel', { resy_token: 'rr://abc', confirmToken: first.confirmToken });
      expect(second.isError).toBe(true);
      const parsed = parse(second);
      expect(parsed.error).toBe('DRAFT_CHANGED');
      expect(parsed.preview.cancellation_fee).toBe(50);
      expect(posts('/3/cancel')).toHaveLength(0);
    });

    it('a client that can be prompted cancels once on accept', async () => {
      routeCancel(LISTING);
      const h = await promptingHarness('accept');
      try {
        const result = await h.callTool('resy_cancel', { resy_token: 'rr://abc' });
        expect(result.isError).toBeFalsy();
        expect(posts('/3/cancel')).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('a client that can be prompted cancels nothing on decline', async () => {
      routeCancel(LISTING);
      const h = await promptingHarness('decline');
      try {
        await h.callTool('resy_cancel', { resy_token: 'rr://abc' });
        expect(posts('/3/cancel')).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot be prompted, and cancels nothing', async () => {
      process.env.MCP_CONFIRM_MODE = 'refuse';
      routeCancel(LISTING);
      const parsed = parse(await harness.callTool('resy_cancel', { resy_token: 'rr://abc' }));
      expect(parsed.reason).toBe('confirmation-unsupported');
      expect(posts('/3/cancel')).toHaveLength(0);
    });
  });

  describe('resy_book', () => {
    // The exact slot a preview of the default routeBook slot hands back: a
    // booking goes ahead only with these fed in, so it books the slot TYPE and
    // TERMS the user saw.
    const DR_CONFIRM = {
      slot_type: 'Dining Room',
      terms_token: bookingTermsToken('Dining Room', null, null),
    };
    const BOOK_19 = { venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00', ...DR_CONFIRM };

    function findResponse(slots: Array<{ token: string; time: string; type?: string }>) {
      return {
        results: {
          venues: [{
            slots: slots.map((s) => ({
              config: { token: s.token, type: s.type ?? 'Dining Room' },
              date: { start: `2026-05-01 ${s.time}:00`, end: '' },
            })),
          }],
        },
      };
    }
    function detailsResponse(type: string, extra: Record<string, unknown> = {}) {
      return {
        book_token: { value: `BK-${type}` },
        venue: { name: 'Carbone', venue_url_slug: 'carbone', location: { url_slug: 'new-york-ny' } },
        config: { type },
        ...extra,
      };
    }
    const patioFee = { fee: { amount: 25, applies: true, date_cut_off: '2026-04-30T17:00:00Z' } };

    /**
     * Route every Resy call resy_book makes by path, so a test can run any
     * number of phases against the same upstream state.
     */
    function routeBook(opts: {
      slots: Array<{ token: string; time: string; type?: string }>;
      /** GET /3/details — a fixed body, or one chosen from the requested path (config_id). */
      details?: Record<string, unknown> | ((path: string) => Record<string, unknown>);
      paymentMethods?: Array<{ id: number; is_default?: boolean; last_four?: string }>;
      bookResponse?: Record<string, unknown>;
      /** GET /3/user/reservations — the duplicate check phase 2 runs before POST /3/book. */
      existingReservations?: { reservations: unknown[]; venues?: Record<string, { name: string }> };
    }) {
      mockRequest.mockImplementation(async (method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/4/find?')) return findResponse(opts.slots);
        if (method === 'GET' && path.startsWith('/3/details?')) {
          const d = opts.details;
          if (typeof d === 'function') return d(path);
          return d ?? {
            book_token: { value: 'BK-1', date_expires: '' },
            venue: { name: 'Carbone', venue_url_slug: 'carbone', location: { url_slug: 'new-york-ny' } },
            config: { type: 'Dining Room' },
          };
        }
        if (method === 'GET' && path === '/2/user') {
          return { payment_methods: opts.paymentMethods ?? [{ id: 55, is_default: true }] };
        }
        if (method === 'GET' && path === '/3/user/reservations') {
          return opts.existingReservations ?? { reservations: [], venues: {} };
        }
        if (method === 'POST' && path === '/3/book') {
          return opts.bookResponse ?? {
            resy_token: 'rr://new', reservation_id: 9001, date: '2026-05-01', time_slot: '19:00', num_seats: 2,
          };
        }
        throw new Error(`unexpected ${method} ${path}`);
      });
    }

    it('runs the find→details→user→book sequence with default payment method', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });

      const { result } = await confirmed('resy_book', BOOK_19);

      // phase 1: find, details, user (a preview — nothing else)
      expect(mockRequest.mock.calls.slice(0, 3).map((c) => c[1].split('?')[0])).toEqual(['/4/find', '/3/details', '/2/user']);
      // phase 2: the same reads fresh, then the duplicate check and the booking
      const phase2 = mockRequest.mock.calls.slice(3);
      expect(phase2).toHaveLength(5);

      expect(phase2[0][0]).toBe('GET');
      expect(phase2[0][1]).toContain('/4/find?');
      expect(phase2[1][0]).toBe('GET');
      expect(phase2[1][1]).toContain('/3/details?');
      expect(phase2[1][1]).toContain('config_id=cfg-7pm');
      expect(phase2[2]).toEqual(['GET', '/2/user']);
      expect(phase2[3]).toEqual(['GET', '/3/user/reservations']);

      const [bookMethod, bookPath, bookBody] = phase2[4];
      expect(bookMethod).toBe('POST');
      expect(bookPath).toBe('/3/book');
      expect(bookBody).toBeInstanceOf(URLSearchParams);
      const bb = bookBody as URLSearchParams;
      expect(bb.get('book_token')).toBe('BK-1');
      expect(JSON.parse(bb.get('struct_payment_method')!)).toEqual({ id: 55 });
      expect(bb.get('source_id')).toBe('resy.com-venue-details');
      expect(posts('/3/book')).toHaveLength(1);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"resy_token":"rr://new"');
      expect(text).toContain('"venue_url":"https://resy.com/cities/new-york-ny/carbone"');
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

    it('does NOT silently book a different time when exact desired_time is missing — even with a confirmToken', async () => {
      // Only find-slots should run; no details/book — the tool asks the caller
      // to pick rather than substituting a time they never requested.
      routeBook({ slots: [{ token: 'cfg-630', time: '18:30' }, { token: 'cfg-730', time: '19:30' }] });

      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:15', confirmToken: 'stale',
      });

      // find only — never /3/details or /3/book
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest.mock.calls[0][1]).toContain('/4/find?');
      expect(posts('/3/book')).toHaveLength(0);

      const parsed = parse(result);
      expect(parsed.preview).toBe(true);
      expect(parsed.booked).toBe(false);
      expect(parsed.requested_time).toBe('19:15');
      expect(parsed.available_times).toEqual(['18:30', '19:30']);
      expect(parsed.note).toMatch(/allow_closest_time/);
    });

    // fleet-audit#225: the booking call must book the slot the user APPROVED,
    // not whatever a fresh fetch happens to rank first/closest by then. So a
    // booking only ever goes ahead for an exact desired_time; anything else is
    // refused with a fresh preview naming the time to book — a confirmToken
    // does not get past it.
    it('allow_closest_time does NOT book a substituted slot, even with a confirmToken — it re-previews', async () => {
      routeBook({ slots: [{ token: 'cfg-630', time: '18:30' }, { token: 'cfg-730', time: '19:30' }] });
      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:15',
        // A matching slot_type + terms_token, so the ONLY thing refusing this
        // booking is the exact-time guard (desired_time && !isClosest).
        allow_closest_time: true, confirmToken: 'stale', ...DR_CONFIRM,
      });
      // 19:30 is closer to 19:15 than 18:30 → previewed via its config token
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-730');
      expect(posts('/3/book')).toHaveLength(0);
      const parsed = parse(result);
      expect(parsed.status).toBeUndefined();
      expect(parsed.preview).toBe(true);
      expect(parsed.booked).toBe(false);
      expect(parsed.time).toBe('19:30');
      expect(parsed.is_closest_match).toBe(true);
      expect(parsed.note).toMatch(/NOT BOOKED/);
      expect(parsed.note).toMatch(/desired_time: "19:30"/);
    });

    it('no desired_time does NOT book the first slot, even with a confirmToken — it re-previews', async () => {
      // e.g. the user approved a preview showing 17:00; by the booking call
      // 17:00 is gone and the first slot is now 17:45. Booking slots[0] would
      // charge for a time nobody approved.
      routeBook({ slots: [{ token: 'cfg-1745', time: '17:45' }, { token: 'cfg-1900', time: '19:00' }] });
      const result = await harness.callTool('resy_book', {
        // Matching slot_type + terms_token: only the missing desired_time refuses it.
        venue_id: 101, date: '2026-05-01', party_size: 2, confirmToken: 'stale', ...DR_CONFIRM,
      });
      expect(posts('/3/book')).toHaveLength(0);
      const parsed = parse(result);
      expect(parsed.preview).toBe(true);
      expect(parsed.booked).toBe(false);
      expect(parsed.time).toBe('17:45');
      expect(parsed.note).toMatch(/desired_time: "17:45"/);
    });

    it('the previewed desired_time books exactly that slot', async () => {
      routeBook({ slots: [{ token: 'cfg-1745', time: '17:45' }, { token: 'cfg-1900', time: '19:00' }] });
      await confirmed('resy_book', BOOK_19);
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-1900');
      expect(posts('/3/book')).toHaveLength(1);
    });

    // fleet-audit#225 (follow-up): a booking is tied to the previewed SLOT, not
    // just its time. Resy lists several seatings at one time (Dining Room / Bar
    // / Patio) with different fees; matching on time alone let a confirm book a
    // same-time Patio slot, with a no-show fee, that nobody previewed.
    it('a preview returns the slot_type and a terms_token to feed back', async () => {
      routeBook({
        slots: [
          { token: 'cfg-dr', time: '17:00', type: 'Dining Room' },
          { token: 'cfg-patio', time: '17:00', type: 'Patio' },
        ],
        details: detailsResponse('Dining Room'),
      });
      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '17:00',
      }));
      expect(parsed.status).toBeUndefined(); // not yet pinned: no token is issued
      expect(parsed.slot_type).toBe('Dining Room');
      expect(parsed.terms_token).toBe(bookingTermsToken('Dining Room', null, null));
      expect(parsed.available_slots).toEqual([
        { time: '17:00', slot_type: 'Dining Room' },
        { time: '17:00', slot_type: 'Patio' },
      ]);
      expect(parsed.note).toMatch(/slot_type: "Dining Room"/);
      expect(parsed.note).toContain(`terms_token: "${parsed.terms_token}"`);
    });

    it('does NOT book a same-time slot of a different type when the previewed one is gone', async () => {
      // Previewed 17:00 Dining Room (no fee). Before the booking call it is
      // taken; only a 17:00 Patio slot with a $25 no-show fee is left.
      routeBook({
        slots: [
          { token: 'cfg-patio', time: '17:00', type: 'Patio' },
          { token: 'cfg-1900', time: '19:00', type: 'Dining Room' },
        ],
        details: detailsResponse('Patio', { cancellation: patioFee }),
      });

      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '17:00', confirmToken: 'stale',
        slot_type: 'Dining Room', terms_token: bookingTermsToken('Dining Room', null, null),
      });

      expect(posts('/3/book')).toHaveLength(0);
      expect(mockRequest.mock.calls.some((c) => String(c[1]).includes('config_id=cfg-patio'))).toBe(false);
      const parsed = parse(result);
      expect(parsed.booked).toBe(false);
      expect(parsed.requested_slot_type).toBe('Dining Room');
      expect(parsed.available_slots).toEqual([
        { time: '17:00', slot_type: 'Patio' },
        { time: '19:00', slot_type: 'Dining Room' },
      ]);
      expect(parsed.note).toMatch(/Dining Room/);
    });

    it('a confirmToken without slot_type does NOT book — it re-previews the slot with its type and terms', async () => {
      routeBook({
        slots: [
          { token: 'cfg-patio', time: '17:00', type: 'Patio' },
          { token: 'cfg-dr', time: '17:00', type: 'Dining Room' },
        ],
        details: detailsResponse('Patio', { cancellation: patioFee }),
      });
      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '17:00', confirmToken: 'stale',
      }));
      expect(posts('/3/book')).toHaveLength(0);
      expect(parsed.booked).toBe(false);
      expect(parsed.slot_type).toBe('Patio');
      expect(parsed.cancellation_policy).toEqual(patioFee);
      expect(parsed.note).toMatch(/NOT BOOKED/);
      expect(parsed.note).toMatch(/fee of 25/);
    });

    it('does NOT book when the slot\'s terms changed since the preview — before any token is issued', async () => {
      // Same slot and type, but a no-show fee was added after the preview.
      routeBook({
        slots: [{ token: 'cfg-dr', time: '17:00', type: 'Dining Room' }],
        details: detailsResponse('Dining Room', { cancellation: patioFee }),
      });
      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '17:00',
        slot_type: 'Dining Room', terms_token: bookingTermsToken('Dining Room', null, null),
      }));
      expect(posts('/3/book')).toHaveLength(0);
      expect(parsed.status).toBeUndefined();
      expect(parsed.booked).toBe(false);
      expect(parsed.note).toMatch(/terms changed/i);
      expect(parsed.terms_token).toBe(bookingTermsToken('Dining Room', patioFee, null));
      expect(parsed.cancellation_policy).toEqual(patioFee);
    });

    it('books the previewed slot type among same-time slots when the terms match', async () => {
      routeBook({
        slots: [
          { token: 'cfg-dr', time: '17:00', type: 'Dining Room' },
          { token: 'cfg-patio', time: '17:00', type: 'Patio' },
        ],
        details: (path) => path.includes('config_id=cfg-patio')
          ? detailsResponse('Patio', { cancellation: patioFee })
          : detailsResponse('Dining Room'),
        bookResponse: { resy_token: 'rr://p', reservation_id: 3, time_slot: '17:00', num_seats: 2 },
      });
      const { result } = await confirmed('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '17:00',
        slot_type: 'patio', terms_token: bookingTermsToken('Patio', patioFee, null),
      });
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-patio');
      expect(posts('/3/book')).toHaveLength(1);
      const bb = posts('/3/book')[0][2] as URLSearchParams;
      expect(bb.get('book_token')).toBe('BK-Patio');
      expect(parse(result).type).toBe('Patio');
    });

    it('bookingTermsToken is stable under key order and changes with the terms', () => {
      expect(bookingTermsToken('Patio', { a: 1, b: { c: 2, d: 3 } }, null))
        .toBe(bookingTermsToken('Patio', { b: { d: 3, c: 2 }, a: 1 }, null));
      expect(bookingTermsToken('Patio', null, null)).not.toBe(bookingTermsToken('Bar', null, null));
      expect(bookingTermsToken('Patio', null, null)).not.toBe(bookingTermsToken('Patio', patioFee, null));
      expect(bookingTermsToken('Patio', null, null)).not.toBe(bookingTermsToken('Patio', null, { deposit: 10 }));
    });

    it('uses explicit payment_method_id when provided and skips /2/user', async () => {
      routeBook({
        slots: [{ token: 'cfg', time: '19:00', type: 'DR' }],
        details: {
          book_token: { value: 'BK', date_expires: '' },
          venue: { name: 'X', venue_url_slug: 'x', location: { url_slug: 'c' } },
          config: { type: 'DR' },
        },
        bookResponse: { resy_token: 'rr://', reservation_id: 1, time_slot: '19:00', num_seats: 2 },
      });

      const { first } = await confirmed('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
        payment_method_id: 42, slot_type: 'DR', terms_token: bookingTermsToken('DR', null, null),
      });

      expect(first.preview.payment_method).toEqual({ id: 42 });
      expect(mockRequest.mock.calls.some((c) => c[1] === '/2/user')).toBe(false);
      expect(posts('/3/book')).toHaveLength(1);
      const bb = posts('/3/book')[0][2] as URLSearchParams;
      expect(JSON.parse(bb.get('struct_payment_method')!)).toEqual({ id: 42 });
    });

    it('throws when no slots are available', async () => {
      routeBook({ slots: [] });
      const result = await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });
      expect(result.isError).toBeTruthy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/no available slots/i);
    });

    it('throws when user has no payment methods', async () => {
      routeBook({ slots: [{ token: 'cfg', time: '19:00' }], paymentMethods: [] });
      const result = await harness.callTool('resy_book', BOOK_19);
      expect(result.isError).toBeTruthy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/no payment method on file/i);
      expect(posts('/3/book')).toHaveLength(0);
    });

    // ─── confirmation gate ────────────────────────────────────────────
    it('phase 1 of a pinned call returns confirmation-required with the full preview and makes NO /3/book call', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        paymentMethods: [{ id: 55, is_default: true, last_four: '4242' }],
      });

      const parsed = parse(await harness.callTool('resy_book', BOOK_19));

      // Reads to build the preview are fine; the mutating POST /3/book must NOT
      // fire, and the duplicate check belongs to phase 2.
      expect(posts('/3/book')).toHaveLength(0);
      expect(mockRequest.mock.calls.some((c) => c[1] === '/3/user/reservations')).toBe(false);

      expect(parsed.status).toBe('confirmation-required');
      expect(parsed.action).toBe('resy.book');
      const p = parsed.preview;
      expect(p.preview).toBe(true);
      expect(p.booked).toBe(false);
      expect(p.action).toBe('book');
      expect(p.time).toBe('19:00'); // exact slot time that would be booked
      expect(p.venue_name).toBe('Carbone');
      expect(p.venue_url).toBe('https://resy.com/cities/new-york-ny/carbone');
      expect(p.date).toBe('2026-05-01');
      expect(p.party_size).toBe(2);
      expect(p.requested_time).toBe('19:00');
      expect(p.is_closest_match).toBe(false);
      expect(p.available_times).toEqual(['19:00']);
      expect(p.available_slots).toEqual([{ time: '19:00', slot_type: 'Dining Room' }]);
      expect(p.slot_type).toBe('Dining Room');
      expect(p.terms_token).toBe(DR_CONFIRM.terms_token);
      expect(p.payment_method).toEqual({ id: 55, last4: '4242' });
      expect(p.cancellation_policy).toBeNull();
      expect(p.payment_terms).toBeNull();
      expect(p.note).toMatch(/nothing was booked/i);
    });

    it('an unpinned call returns a preview naming the exact slot to book', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        paymentMethods: [{ id: 55, is_default: true, last_four: '4242' }],
      });

      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      }));

      expect(posts('/3/book')).toHaveLength(0);
      expect(parsed.status).toBeUndefined();
      expect(parsed.preview).toBe(true);
      expect(parsed.booked).toBe(false);
      expect(parsed.action).toBe('book');
      expect(parsed.time).toBe('19:00');
      expect(parsed.venue_name).toBe('Carbone');
      expect(parsed.party_size).toBe(2);
      expect(parsed.is_closest_match).toBe(false);
      expect(parsed.payment_method).toEqual({ id: 55, last4: '4242' });
      expect(parsed.note).toMatch(/nothing was booked/i);
      expect(parsed.note).toContain('desired_time: "19:00"');
      expect(parsed.note).not.toMatch(/confirm: true/);
    });

    it('preview takes the first available slot and reports requested_time:null when desired_time is omitted', async () => {
      routeBook({
        slots: [{ token: 'cfg-630', time: '18:30' }, { token: 'cfg-730', time: '19:30' }],
        paymentMethods: [{ id: 55, is_default: true, last_four: '4242' }],
      });

      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      }));

      // Read-only preview: the mutating POST /3/book must NOT fire.
      expect(posts('/3/book')).toHaveLength(0);
      // First-slot fallback resolves against the FIRST slot's config token.
      expect(mockRequest.mock.calls[1][1]).toContain('config_id=cfg-630');

      expect(parsed.preview).toBe(true);
      expect(parsed.booked).toBe(false);
      expect(parsed.time).toBe('18:30'); // first available slot
      expect(parsed.requested_time).toBe(null); // desired_time omitted
      expect(parsed.is_closest_match).toBe(false);
      expect(parsed.available_times).toEqual(['18:30', '19:30']);
      expect(parsed.note).toContain('desired_time: "18:30"');
    });

    it('preview flags a closest-time substitution when allow_closest_time:true', async () => {
      routeBook({
        slots: [{ token: 'cfg-630', time: '18:30' }, { token: 'cfg-730', time: '19:30' }],
      });

      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:15',
        allow_closest_time: true,
      }));

      expect(posts('/3/book')).toHaveLength(0);
      expect(parsed.preview).toBe(true);
      expect(parsed.is_closest_match).toBe(true);
      expect(parsed.time).toBe('19:30');
      expect(parsed.requested_time).toBe('19:15');
      expect(parsed.note).toMatch(/CLOSEST slot \(19:30\)/);
    });

    // fleet-audit#226: /3/details carries the slot's cancellation and payment
    // terms (no-show fee, deposit, cut-off). The preview used to drop them, so
    // a booking could commit the card to a fee the user never saw.
    it('preview surfaces the slot\'s cancellation fee and payment terms from /3/details', async () => {
      const cancellation = {
        fee: { amount: 50, date_cut_off: '2026-04-30T19:00:00Z', display: { amount: '$50 per person' } },
        display: { policy: ['Cancel by 7pm the day before to avoid a $50 per person fee.'] },
      };
      const payment = { amounts: { reservation_charge: 0, total: 0 }, config: { type: 'free' } };
      routeBook({
        slots: [{ token: 'cfg', time: '19:00', type: 'DR' }],
        details: {
          book_token: { value: 'BK' },
          venue: { name: 'Carbone', venue_url_slug: 'carbone', location: { url_slug: 'new-york-ny' } },
          config: { type: 'DR' },
          cancellation,
          payment,
        },
      });

      const unpinned = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      }));
      expect(unpinned.cancellation_policy).toEqual(cancellation);
      expect(unpinned.payment_terms).toEqual(payment);
      expect(unpinned.note).toMatch(/no-show fee of 50/i);
      expect(unpinned.note).toMatch(/2026-04-30T19:00:00Z/);

      // …and so does the preview a confirmation is asked against.
      const gated = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
        slot_type: 'DR', terms_token: unpinned.terms_token,
      }));
      expect(gated.status).toBe('confirmation-required');
      expect(gated.preview.cancellation_policy).toEqual(cancellation);
      expect(gated.preview.payment_terms).toEqual(payment);
      expect(gated.preview.note).toMatch(/no-show fee of 50/i);
      expect(posts('/3/book')).toHaveLength(0);
    });

    it('preview says the terms are unknown when /3/details returns none', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      }));
      expect(parsed.cancellation_policy).toBeNull();
      expect(parsed.payment_terms).toBeNull();
      expect(parsed.note).not.toMatch(/cancellation fee/i);
    });

    // fleet-audit#227: a POST /3/book that outlives the MCP client's timeout
    // looks like a failure to the model while the booking completes on Resy's
    // side; the natural retry then books twice. The booking call therefore
    // checks for an existing reservation at the same venue + date first.
    it('refuses when a reservation already exists at the same venue and date', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        existingReservations: {
          reservations: [
            { resy_token: 'rr://earlier', reservation_id: 9, venue: { id: 101 }, day: '2026-05-01', time_slot: '19:00:00', num_seats: 2 },
          ],
          venues: { '101': { name: 'Carbone' } },
        },
      });
      const { result } = await confirmed('resy_book', BOOK_19);
      expect(posts('/3/book')).toHaveLength(0);
      const parsed = parse(result);
      expect(parsed.booked).toBe(false);
      expect(parsed.existing_reservations).toHaveLength(1);
      expect(parsed.existing_reservations[0].resy_token).toBe('rr://earlier');
      expect(parsed.note).toMatch(/allow_duplicate: true/);
      // The re-run must also carry the exact slot, or it only re-previews.
      expect(parsed.slot_type).toBe('Dining Room');
      expect(parsed.terms_token).toBe(DR_CONFIRM.terms_token);
      expect(parsed.note).toContain('desired_time: "19:00"');
      expect(parsed.note).toContain('slot_type: "Dining Room"');
      expect(parsed.note).toContain(`terms_token: "${DR_CONFIRM.terms_token}"`);
      expect(parsed.note).not.toMatch(/confirm: true/);
    });

    it('ignores reservations at other venues or on other dates', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        existingReservations: {
          reservations: [
            { resy_token: 'rr://other-venue', venue: { id: 202 }, day: '2026-05-01' },
            { resy_token: 'rr://other-day', venue: { id: 101 }, day: '2026-05-02' },
          ],
        },
      });
      await confirmed('resy_book', BOOK_19);
      expect(posts('/3/book')).toHaveLength(1);
    });

    it('allow_duplicate:true books despite an existing reservation at the venue that day', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        existingReservations: {
          reservations: [{ resy_token: 'rr://earlier', venue: { id: 101 }, day: '2026-05-01' }],
        },
      });
      await confirmed('resy_book', { ...BOOK_19, allow_duplicate: true });
      expect(posts('/3/book')).toHaveLength(1);
    });

    it('preview shows only the payment id when the card exposes no last-4', async () => {
      routeBook({
        slots: [{ token: 'cfg-7pm', time: '19:00' }],
        paymentMethods: [{ id: 77, is_default: true }],
      });
      const parsed = parse(await harness.callTool('resy_book', {
        venue_id: 101, date: '2026-05-01', party_size: 2, desired_time: '19:00',
      }));
      expect(parsed.payment_method).toEqual({ id: 77 });
    });

    it('replaying a used confirmToken is refused as TOKEN_REUSED and books nothing more', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const { first } = await confirmed('resy_book', BOOK_19);
      expect(posts('/3/book')).toHaveLength(1);

      const replay = await harness.callTool('resy_book', { ...BOOK_19, confirmToken: first.confirmToken });
      expect(replay.isError).toBe(true);
      expect(parse(replay).error).toBe('TOKEN_REUSED');
      expect(posts('/3/book')).toHaveLength(1);
    });

    it('changing an argument between the phases is refused as DRAFT_CHANGED and books nothing', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const first = parse(await harness.callTool('resy_book', BOOK_19));
      expect(first.status).toBe('confirmation-required');

      const changed = await harness.callTool('resy_book', { ...BOOK_19, party_size: 4, confirmToken: first.confirmToken });
      expect(changed.isError).toBe(true);
      const parsed = parse(changed);
      expect(parsed.error).toBe('DRAFT_CHANGED');
      expect(parsed.preview.party_size).toBe(4);
      expect(typeof parsed.confirmToken).toBe('string');
      expect(posts('/3/book')).toHaveLength(0);
    });

    it('a client that can be prompted books once on accept, with no token', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const h = await promptingHarness('accept');
      try {
        const result = await h.callTool('resy_book', BOOK_19);
        expect(result.isError).toBeFalsy();
        expect(parse(result).resy_token).toBe('rr://new');
        expect(posts('/3/book')).toHaveLength(1);
      } finally {
        await h.close();
      }
    });

    it('a client that can be prompted books nothing on decline', async () => {
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const h = await promptingHarness('decline');
      try {
        await h.callTool('resy_book', BOOK_19);
        expect(posts('/3/book')).toHaveLength(0);
      } finally {
        await h.close();
      }
    });

    it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot be prompted, and books nothing', async () => {
      process.env.MCP_CONFIRM_MODE = 'refuse';
      routeBook({ slots: [{ token: 'cfg-7pm', time: '19:00' }] });
      const parsed = parse(await harness.callTool('resy_book', BOOK_19));
      expect(parsed.reason).toBe('confirmation-unsupported');
      expect(posts('/3/book')).toHaveLength(0);
    });
  });
});
