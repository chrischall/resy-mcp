import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';
import { textResult } from '../mcp.js';
import { findSlotsAtVenue, type FormattedSlot } from './venues.js';

/**
 * Real Resy shape from GET /3/user/reservations (verified via smoke):
 *   { reservations: [...], venues: { "<id>": {...} }, metadata: {...} }
 * The `venues` map is keyed by venue id as a string; venue.name lives there,
 * NOT inline on each reservation.
 */
interface RawReservation {
  resy_token?: string;
  reservation_id?: number;
  venue?: { id?: number };
  day?: string; // YYYY-MM-DD
  time_slot?: string; // "19:30:00"
  num_seats?: number;
  config?: { type?: string };
  occasion?: string | null;
  special_request?: string | null;
  cancellation?: {
    allowed?: boolean;
    fee?: { amount?: number; applies?: boolean; date_cut_off?: string };
  };
}

interface ReservationsResponse {
  reservations?: RawReservation[];
  venues?: Record<string, { name?: string }>;
}

/**
 * Trim trailing seconds from Resy's HH:MM:SS for caller-facing output.
 */
function trimSeconds(t: string | undefined): string {
  if (!t) return '';
  const m = /^(\d{2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

function formatReservation(
  r: RawReservation,
  venues: Record<string, { name?: string }>
): {
  resy_token: string;
  reservation_id: number | undefined;
  venue_id: number | undefined;
  venue_name: string;
  date: string;
  time: string;
  party_size: number;
  type: string;
  occasion: string | null;
  special_request: string | null;
  cancellable: boolean;
  cancellation_fee?: number;
} {
  const venueId = r.venue?.id;
  const venueName = venueId !== undefined ? venues[String(venueId)]?.name : undefined;
  const fee = r.cancellation?.fee;
  return {
    resy_token: r.resy_token ?? '',
    reservation_id: r.reservation_id,
    venue_id: venueId,
    venue_name: venueName ?? 'Unknown',
    date: r.day ?? '',
    time: trimSeconds(r.time_slot),
    party_size: r.num_seats ?? 0,
    type: r.config?.type ?? 'Dining Room',
    occasion: r.occasion ?? null,
    special_request: r.special_request ?? null,
    cancellable: r.cancellation?.allowed ?? false,
    ...(fee?.applies && fee.amount !== undefined ? { cancellation_fee: fee.amount } : {}),
  };
}

/**
 * Today's date in YYYY-MM-DD, in the LOCAL zone. Used for client-side scope
 * filtering because Resy's `scope` query param is currently a no-op (all
 * scopes return the same list).
 */
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ─── resy_book helpers ────────────────────────────────────────────────

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map((n) => Number(n));
  return h * 60 + (m || 0);
}

/**
 * Pick the slot with exact time match; else closest by minute-delta;
 * else the first slot. `slots` must be non-empty.
 */
function pickSlot(slots: FormattedSlot[], desiredTime: string | undefined): FormattedSlot {
  if (!desiredTime) return slots[0];
  const exact = slots.find((s) => s.time === desiredTime);
  if (exact) return exact;
  const desired = toMinutes(desiredTime);
  return slots.reduce((best, s) =>
    Math.abs(toMinutes(s.time) - desired) < Math.abs(toMinutes(best.time) - desired) ? s : best
  );
}

interface BookingDetails {
  book_token: string;
  venue_name: string;
  venue_url: string;
  slot_type: string;
}

async function getBookingDetails(
  client: ResyClient,
  args: { config_token: string; date: string; party_size: number; slot_type_fallback: string }
): Promise<BookingDetails> {
  const params = new URLSearchParams({
    config_id: args.config_token,
    day: args.date,
    party_size: String(args.party_size),
  });
  const details = await client.request<{
    book_token?: { value?: string };
    venue?: { name?: string; venue_url_slug?: string; location?: { url_slug?: string } };
    config?: { type?: string };
  }>('GET', `/3/details?${params.toString()}`);

  const token = details.book_token?.value;
  if (!token) throw new Error('Resy did not return a book_token for this slot');

  const citySlug = details.venue?.location?.url_slug ?? 'new-york-ny';
  const venueSlug = details.venue?.venue_url_slug ?? '';
  return {
    book_token: token,
    venue_name: details.venue?.name ?? 'Restaurant',
    venue_url: venueSlug
      ? `https://resy.com/cities/${citySlug}/${venueSlug}`
      : 'https://resy.com',
    slot_type: details.config?.type ?? args.slot_type_fallback,
  };
}

/**
 * Return the user's default payment method id (or first available).
 * Throws a clear user-facing error if none are on file.
 */
async function resolveDefaultPaymentMethod(client: ResyClient): Promise<number> {
  const user = await client.request<{
    payment_methods?: Array<{ id?: number; is_default?: boolean }>;
  }>('GET', '/2/user');
  const methods = user.payment_methods ?? [];
  const def = methods.find((m) => m.is_default) ?? methods[0];
  if (!def?.id) {
    throw new Error('No payment method on file. Add one at resy.com/account before booking.');
  }
  return def.id;
}

// ─── tool registrations ───────────────────────────────────────────────

export function registerReservationTools(
  server: McpServer,
  client: ResyClient
): void {
  server.registerTool(
    'resy_list_reservations',
    {
      description:
        "List the user's Resy reservations. Defaults to upcoming; pass scope=\"past\" or \"all\" to broaden. Each result includes the resy_token needed for cancellation, plus occasion/special_request/cancellability.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        scope: z.enum(['upcoming', 'past', 'all']).optional(),
      },
    },
    async ({ scope }) => {
      const scopeResolved = scope ?? 'upcoming';
      const data = await client.request<ReservationsResponse>(
        'GET',
        '/3/user/reservations'
      );
      const venues = data.venues ?? {};
      const today = todayYMD();
      const filtered = (data.reservations ?? []).filter((r) => {
        if (scopeResolved === 'all') return true;
        const day = r.day ?? '';
        // YYYY-MM-DD strings compare lexicographically = chronologically
        return scopeResolved === 'upcoming' ? day >= today : day < today;
      });
      return textResult(filtered.map((r) => formatReservation(r, venues)));
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
      // Resy's cancel response shape isn't documented. Treat obvious failure
      // signals as cancelled=false; otherwise assume HTTP-OK means success.
      // Callers always get `raw` for the truth.
      const status = typeof data.status === 'string' ? data.status.toLowerCase() : undefined;
      const hasErrorField = 'error' in data || 'error_message' in data;
      const explicitSuccess =
        (status !== undefined && /cancel/.test(status)) || data.ok === true;
      const explicitFailure =
        data.ok === false ||
        (status !== undefined && /fail|error|denied/.test(status)) ||
        hasErrorField;
      const cancelled = explicitSuccess || !explicitFailure;
      return textResult({ cancelled, raw: data });
    }
  );

  server.registerTool(
    'resy_book',
    {
      description:
        "Book a reservation. Composite tool: internally runs find-slots → get booking details → book. Pass desired_time (HH:MM, 24-hour) to target a specific slot; otherwise the first available is used. Uses the user's default payment method unless payment_method_id is supplied.",
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        desired_time: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'desired_time must be HH:MM (24h), e.g. 19:30')
          .optional()
          .describe('HH:MM (24h)'),
        lat: z.number().optional(),
        lng: z.number().optional(),
        payment_method_id: z.number().int().positive().optional(),
      },
    },
    async ({ venue_id, date, party_size, desired_time, lat, lng, payment_method_id }) => {
      // 1. find fresh slots (via shared helper)
      const slots = await findSlotsAtVenue(client, { venue_id, date, party_size, lat, lng });
      if (slots.length === 0) {
        throw new Error(
          'No available slots for this venue/date/party size. The restaurant may be fully booked.'
        );
      }

      // 2. pick a slot
      const chosen = pickSlot(slots, desired_time);

      // 3. resolve book_token + venue metadata
      const details = await getBookingDetails(client, {
        config_token: chosen.config_token,
        date,
        party_size,
        slot_type_fallback: chosen.type,
      });

      // 4. resolve payment method
      const paymentId = payment_method_id ?? (await resolveDefaultPaymentMethod(client));

      // 5. book
      const bookBody = new URLSearchParams({
        book_token: details.book_token,
        struct_payment_method: JSON.stringify({ id: paymentId }),
        source_id: 'resy.com-venue-details',
      });
      const booked = await client.request<{
        resy_token?: string;
        reservation_id?: number;
        time_slot?: string;
        num_seats?: number;
      }>('POST', '/3/book', bookBody);

      return textResult({
        resy_token: booked.resy_token,
        reservation_id: booked.reservation_id,
        venue_name: details.venue_name,
        venue_url: details.venue_url,
        date,
        time: trimSeconds(booked.time_slot) || chosen.time,
        party_size: booked.num_seats ?? party_size,
        type: details.slot_type,
      });
    }
  );
}
