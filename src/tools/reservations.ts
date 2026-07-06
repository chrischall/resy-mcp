import { z } from 'zod';
import { extractTime, schemaConfirm, toolAnnotations } from '@chrischall/mcp-utils';
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
 * Backed by the fleet-shared `extractTime` — both pull a leading `HH:MM`
 * and return `''` on empty input (identical for Resy's `HH:MM[:SS]` times).
 */
function trimSeconds(t: string | undefined): string {
  return extractTime(t);
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

interface SlotSelection {
  /** The slot that would be booked, or `undefined` when the caller must pick
   *  (an exact `desiredTime` was requested, wasn't available, and closest-time
   *  fallback wasn't explicitly allowed). */
  chosen?: FormattedSlot;
  /** True when we fell back to the nearest slot instead of an exact match
   *  (only ever set when `allowClosest` was true). Surfaced in the preview so
   *  a confirm is an informed one. */
  isClosest: boolean;
}

/**
 * Select which slot `resy_book` would book — WITHOUT silently substituting a
 * different time for a requested one.
 *
 *  - No `desiredTime`      → first available slot (caller wants "any").
 *  - Exact match found     → that slot.
 *  - Exact match missing:
 *      - `allowClosest`    → nearest-by-minute slot, flagged `isClosest`.
 *      - otherwise         → `chosen: undefined` — the tool returns the
 *                            available times and asks the caller to pick,
 *                            rather than booking a time they didn't ask for.
 *
 * `slots` must be non-empty.
 */
function selectSlot(
  slots: FormattedSlot[],
  desiredTime: string | undefined,
  allowClosest: boolean
): SlotSelection {
  if (!desiredTime) return { chosen: slots[0], isClosest: false };
  const exact = slots.find((s) => s.time === desiredTime);
  if (exact) return { chosen: exact, isClosest: false };
  if (!allowClosest) return { chosen: undefined, isClosest: false };
  const desired = toMinutes(desiredTime);
  const closest = slots.reduce((best, s) =>
    Math.abs(toMinutes(s.time) - desired) < Math.abs(toMinutes(best.time) - desired) ? s : best
  );
  return { chosen: closest, isClosest: true };
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

/** A resolved payment method: always an id, plus the last-4 when Resy exposes
 *  it (so the confirm preview can show WHICH card would be charged). */
interface ResolvedPayment {
  id: number;
  last4?: string;
}

/** Pull the trailing 4 digits Resy surfaces for a card, from whichever field
 *  it uses (`last_four`, or embedded in a `display` label like "Visa •••• 4242"). */
function paymentLast4(m: { last_four?: string | number; display?: string }): string | undefined {
  if (m.last_four !== undefined && m.last_four !== null && `${m.last_four}` !== '') {
    return `${m.last_four}`.slice(-4);
  }
  const fromDisplay = m.display?.match(/(\d{4})(?!.*\d)/);
  return fromDisplay ? fromDisplay[1] : undefined;
}

/**
 * Return the user's default payment method (or first available), including the
 * last-4 when Resy exposes it. Throws a clear user-facing error if none are on
 * file.
 */
async function resolveDefaultPaymentMethod(client: ResyClient): Promise<ResolvedPayment> {
  const user = await client.request<{
    payment_methods?: Array<{
      id?: number;
      is_default?: boolean;
      last_four?: string | number;
      display?: string;
    }>;
  }>('GET', '/2/user');
  const methods = user.payment_methods ?? [];
  const def = methods.find((m) => m.is_default) ?? methods[0];
  if (!def?.id) {
    throw new Error('No payment method on file. Add one at resy.com/account before booking.');
  }
  const last4 = paymentLast4(def);
  return { id: def.id, ...(last4 ? { last4 } : {}) };
}

/**
 * Look up a single reservation by its `resy_token` so `resy_cancel` can show
 * WHAT it's about to cancel (venue, date, time, party size, any cancellation
 * fee) in its dry-run preview. Read-only; returns `undefined` when the token
 * isn't found in the user's reservation list.
 */
async function findReservationByToken(
  client: ResyClient,
  resyToken: string
): Promise<ReturnType<typeof formatReservation> | undefined> {
  const data = await client.request<ReservationsResponse>('GET', '/3/user/reservations');
  const venues = data.venues ?? {};
  const match = (data.reservations ?? []).find((r) => r.resy_token === resyToken);
  return match ? formatReservation(match, venues) : undefined;
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
        'Cancel a Resy reservation by its resy_token (the rr://... identifier returned from resy_book or resy_list_reservations). ' +
        'Confirm-gated: without confirm:true this returns a dry-run preview (venue, date, time, party size, and any cancellation fee) and cancels nothing.',
      annotations: {
        ...toolAnnotations({ title: 'Cancel a Resy reservation', readOnly: false }),
        destructiveHint: true,
      },
      inputSchema: {
        resy_token: z.string().describe('rr://... reservation identifier'),
        confirm: schemaConfirm,
      },
    },
    async ({ resy_token, confirm }) => {
      // Dry-run preview: look up (read-only) what would be cancelled and make
      // NO cancel call. Only confirm:true reaches POST /3/cancel.
      if (confirm !== true) {
        const info = await findReservationByToken(client, resy_token);
        return textResult({
          preview: true,
          action: 'cancel',
          cancelled: false,
          note: info
            ? `DRY RUN — nothing was cancelled. Re-run with confirm: true to cancel this reservation.${
                info.cancellation_fee !== undefined
                  ? ` A cancellation fee of ${info.cancellation_fee} applies.`
                  : ''
              }`
            : 'DRY RUN — nothing was cancelled. This resy_token was not found in your reservation list; re-run with confirm: true to attempt cancellation anyway.',
          resy_token,
          ...(info
            ? {
                venue_name: info.venue_name,
                date: info.date,
                time: info.time,
                party_size: info.party_size,
                cancellable: info.cancellable,
                ...(info.cancellation_fee !== undefined
                  ? { cancellation_fee: info.cancellation_fee }
                  : {}),
              }
            : {}),
        });
      }
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
        "Book a reservation. Composite tool: internally runs find-slots → get booking details → book. " +
        'Confirm-gated: without confirm:true this returns a dry-run preview (venue, date, party size, the exact ' +
        'slot time that would be booked, and the payment card last-4) and books nothing. ' +
        'Pass desired_time (HH:MM, 24-hour) to target a specific slot. If your exact desired_time is not ' +
        'available the tool does NOT auto-book a different time — it returns the available times so you can pick, ' +
        'unless you pass allow_closest_time:true. Omit desired_time to take the first available slot. ' +
        "Uses the user's default payment method unless payment_method_id is supplied.",
      annotations: {
        ...toolAnnotations({ title: 'Book a Resy reservation', readOnly: false }),
        destructiveHint: true,
      },
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        desired_time: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'desired_time must be HH:MM (24h), e.g. 19:30')
          .optional()
          .describe('HH:MM (24h)'),
        allow_closest_time: z
          .boolean()
          .optional()
          .describe(
            'When true, if your exact desired_time is unavailable the closest slot is booked instead of ' +
              'returning the available times to pick from. Default false: an unavailable desired_time never ' +
              'silently books a different time.'
          ),
        lat: z.number().optional(),
        lng: z.number().optional(),
        payment_method_id: z.number().int().positive().optional(),
        confirm: schemaConfirm,
      },
    },
    async ({
      venue_id,
      date,
      party_size,
      desired_time,
      allow_closest_time,
      lat,
      lng,
      payment_method_id,
      confirm,
    }) => {
      // 1. find fresh slots (via shared helper — read-only)
      const slots = await findSlotsAtVenue(client, { venue_id, date, party_size, lat, lng });
      if (slots.length === 0) {
        throw new Error(
          'No available slots for this venue/date/party size. The restaurant may be fully booked.'
        );
      }

      // 2. pick a slot — WITHOUT silently substituting a requested time.
      const selection = selectSlot(slots, desired_time, allow_closest_time === true);
      if (!selection.chosen) {
        // Exact desired_time requested, not available, closest not allowed.
        // Book nothing; hand back the options so the caller makes the choice.
        return textResult({
          preview: true,
          action: 'book',
          booked: false,
          note:
            `Requested time ${desired_time} is not available at this venue on ${date}. Nothing was booked. ` +
            `Re-run with a desired_time from available_times, or pass allow_closest_time: true to book the ` +
            `nearest slot — then add confirm: true to book.`,
          venue_id,
          date,
          party_size,
          requested_time: desired_time,
          available_times: slots.map((s) => s.time),
        });
      }
      const chosen = selection.chosen;

      // 3. resolve book_token + venue metadata (read-only)
      const details = await getBookingDetails(client, {
        config_token: chosen.config_token,
        date,
        party_size,
        slot_type_fallback: chosen.type,
      });

      // 4. resolve payment method (read-only when defaulting)
      const payment: ResolvedPayment =
        payment_method_id !== undefined
          ? { id: payment_method_id }
          : await resolveDefaultPaymentMethod(client);

      // 5. dry-run preview unless explicitly confirmed. Everything above is a
      //    read; the booking POST below is the only mutation and it requires
      //    confirm:true. The preview surfaces the EXACT slot time so a confirm
      //    is an informed one.
      if (confirm !== true) {
        return textResult({
          preview: true,
          action: 'book',
          booked: false,
          note:
            `DRY RUN — nothing was booked. Re-run with confirm: true to book this slot.` +
            (selection.isClosest
              ? ` NOTE: your requested time ${desired_time} was unavailable, so the CLOSEST slot (${chosen.time}) was selected.`
              : ''),
          venue_name: details.venue_name,
          venue_url: details.venue_url,
          date,
          time: chosen.time,
          requested_time: desired_time ?? null,
          is_closest_match: selection.isClosest,
          available_times: slots.map((s) => s.time),
          party_size,
          slot_type: details.slot_type,
          payment_method: { id: payment.id, ...(payment.last4 ? { last4: payment.last4 } : {}) },
        });
      }

      // 6. book (the only mutating call)
      const bookBody = new URLSearchParams({
        book_token: details.book_token,
        struct_payment_method: JSON.stringify({ id: payment.id }),
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
