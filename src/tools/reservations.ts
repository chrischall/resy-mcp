import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';
import { DEFAULT_LAT, DEFAULT_LNG, extractHHMM } from './venues.js';

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
      // Determine if the cancel actually went through. Resy's shape isn't
      // documented; probe the common positive signals. If no signal is present
      // but the request was HTTP-OK, default to true — `raw` carries the truth.
      const status = typeof data.status === 'string' ? data.status.toLowerCase() : undefined;
      const hasErrorField = 'error' in data || 'error_message' in data;
      const explicitSuccess =
        (status !== undefined && /cancel/.test(status)) ||
        data.ok === true;
      const explicitFailure =
        data.ok === false ||
        (status !== undefined && /fail|error|denied/.test(status)) ||
        hasErrorField;
      const cancelled = explicitSuccess || !explicitFailure;
      const result = { cancelled, raw: data };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

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
        lat: String(lat ?? DEFAULT_LAT),
        long: String(lng ?? DEFAULT_LNG),
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

      // 2. pick a slot — exact match, else closest time, else first.
      // extractHHMM parses the string directly (no Date round-trip) so slot
      // times aren't shifted by the caller's local timezone.
      const slotsWithTime = rawSlots.map((s) => ({
        token: s.config?.token ?? '',
        type: s.config?.type ?? 'Dining Room',
        time: extractHHMM(s.date?.start),
      }));
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
}
