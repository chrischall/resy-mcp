import { z } from 'zod';
import { extractTime, schemaConfirm, toolAnnotations } from '@chrischall/mcp-utils';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ResyClient } from '../client.js';
import { minifiedResult } from '../mcp.js';
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
 * The upcoming/past boundary as YYYY-MM-DD, for client-side scope filtering
 * (Resy's `scope` query param is a no-op — all scopes return the same list).
 *
 * NOT the server's local date: hosted, the process runs in UTC, so from 8pm
 * EDT onward "today" was already tomorrow and tonight's booking was filed
 * under "past" (fleet-audit#228). A reservation's `day` is venue-local and
 * the venue's zone isn't in the payload, so this is the date in the EARLIEST
 * zone on Earth (UTC-12, "Anywhere on Earth"): a day only counts as past once
 * it has ended everywhere, so a booking is never hidden while its evening can
 * still be ahead. The cost is at most a few hours in which yesterday's
 * reservation is still listed as upcoming — the safe direction.
 */
function upcomingBoundaryYMD(): string {
  return new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

/** Case- and whitespace-insensitive comparison of Resy seating types
 *  ("Dining Room" vs "dining room"). */
function sameSlotType(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Select which slot `resy_book` would book — WITHOUT silently substituting a
 * different time, or a different seating type, for a requested one.
 *
 * Resy often lists several slots at the same time with different
 * `config.type` values (Dining Room / Bar / Patio / Counter), each with its
 * own fees, so when `slotType` is given only slots of that type are
 * candidates (fleet-audit#225).
 *
 *  - No `desiredTime`      → first available candidate (caller wants "any").
 *  - Exact match found     → that slot.
 *  - Exact match missing:
 *      - `allowClosest`    → nearest-by-minute candidate, flagged `isClosest`.
 *      - otherwise         → `chosen: undefined` — the tool returns the
 *                            available slots and asks the caller to pick,
 *                            rather than booking a slot they didn't ask for.
 */
function selectSlot(
  slots: FormattedSlot[],
  desiredTime: string | undefined,
  allowClosest: boolean,
  slotType?: string
): SlotSelection {
  const candidates =
    slotType === undefined ? slots : slots.filter((s) => sameSlotType(s.type, slotType));
  if (candidates.length === 0) return { chosen: undefined, isClosest: false };
  if (!desiredTime) return { chosen: candidates[0], isClosest: false };
  const exact = candidates.find((s) => s.time === desiredTime);
  if (exact) return { chosen: exact, isClosest: false };
  if (!allowClosest) return { chosen: undefined, isClosest: false };
  const desired = toMinutes(desiredTime);
  const closest = candidates.reduce((best, s) =>
    Math.abs(toMinutes(s.time) - desired) < Math.abs(toMinutes(best.time) - desired) ? s : best
  );
  return { chosen: closest, isClosest: true };
}

/** JSON with object keys sorted at every level, so the same terms always
 *  serialise identically regardless of the order Resy sends keys in. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A short fingerprint of the terms a booking commits the card to: the seating
 * type plus the raw cancellation and payment blocks from GET /3/details. The
 * preview returns it; a confirm must feed it back, and books only when the
 * freshly fetched slot still has the same fingerprint — so a fee added (or a
 * different seating substituted) between preview and confirm re-previews
 * instead of booking (fleet-audit#225/#226).
 *
 * Change detection, not security: a 64-bit FNV-1a over the stable JSON, so it
 * runs anywhere (Node or a Worker) without a crypto import.
 */
export function bookingTermsToken(
  slotType: string,
  cancellation: unknown,
  payment: unknown
): string {
  const input = stableStringify({ slot_type: slotType, cancellation: cancellation ?? null, payment: payment ?? null });
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(input)) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * The slot's cancellation block from GET /3/details. Only `fee` is read
 * field-by-field (to phrase the preview note); the whole block is passed
 * through raw, because its shape is undocumented and a partial read is how
 * the terms went missing in the first place (fleet-audit#226).
 */
interface DetailsCancellation {
  fee?: { amount?: number; applies?: boolean; date_cut_off?: string };
  [key: string]: unknown;
}

interface BookingDetails {
  book_token: string;
  venue_name: string;
  venue_url: string;
  slot_type: string;
  /** Raw `cancellation` block (no-show/cancel fee, cut-off, policy text), or null when absent. */
  cancellation: DetailsCancellation | null;
  /** Raw `payment` block (amounts, deposit, config.type), or null when absent. */
  payment: Record<string, unknown> | null;
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
    cancellation?: DetailsCancellation;
    payment?: Record<string, unknown>;
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
    cancellation: details.cancellation ?? null,
    payment: details.payment ?? null,
  };
}

/** A one-line fee warning for the preview note, or '' when no fee is stated. */
function cancellationFeeNote(c: DetailsCancellation | null): string {
  const fee = c?.fee;
  if (!fee || fee.applies === false || typeof fee.amount !== 'number' || fee.amount <= 0) return '';
  return (
    ` A cancellation/no-show fee of ${fee.amount} applies` +
    (fee.date_cut_off ? ` if cancelled after ${fee.date_cut_off}` : '') +
    ' — see cancellation_policy.'
  );
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

/**
 * The user's reservations at `venueId` on `date` — the duplicate check a
 * `resy_book` confirm runs before POST /3/book. A booking POST that outlives
 * the MCP client's tool-call timeout reports failure to the model while it
 * completes on Resy's side; the natural retry would book a second table
 * (fleet-audit#227). Read-only.
 */
async function findReservationsAtVenueOnDate(
  client: ResyClient,
  venueId: number,
  date: string
): Promise<Array<ReturnType<typeof formatReservation>>> {
  const data = await client.request<ReservationsResponse>('GET', '/3/user/reservations');
  const venues = data.venues ?? {};
  return (data.reservations ?? [])
    .filter((r) => r.venue?.id === venueId && r.day === date)
    .map((r) => formatReservation(r, venues));
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
      inputSchema: z.object({
        scope: z.enum(['upcoming', 'past', 'all']).optional(),
      }),
    },
    async ({ scope }) => {
      const scopeResolved = scope ?? 'upcoming';
      const data = await client.request<ReservationsResponse>(
        'GET',
        '/3/user/reservations'
      );
      const venues = data.venues ?? {};
      const today = upcomingBoundaryYMD();
      const filtered = (data.reservations ?? []).filter((r) => {
        if (scopeResolved === 'all') return true;
        const day = r.day ?? '';
        // YYYY-MM-DD strings compare lexicographically = chronologically
        return scopeResolved === 'upcoming' ? day >= today : day < today;
      });
      return minifiedResult(filtered.map((r) => formatReservation(r, venues)));
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
      inputSchema: z.object({
        resy_token: z.string().describe('rr://... reservation identifier'),
        confirm: schemaConfirm,
      }),
    },
    async ({ resy_token, confirm }) => {
      // Dry-run preview: look up (read-only) what would be cancelled and make
      // NO cancel call. Only confirm:true reaches POST /3/cancel.
      if (confirm !== true) {
        const info = await findReservationByToken(client, resy_token);
        return minifiedResult({
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
      return minifiedResult({ cancelled, raw: data });
    }
  );

  server.registerTool(
    'resy_book',
    {
      description:
        "Book a reservation. Composite tool: internally runs find-slots → get booking details → book. " +
        'Confirm-gated: without confirm:true this returns a dry-run preview (venue, date, party size, the exact ' +
        'slot time that would be booked, the payment card last-4, and the slot\'s cancellation_policy / ' +
        'payment_terms — any no-show fee or deposit) and books nothing. ' +
        'Pass desired_time (HH:MM, 24-hour) to target a specific slot. If your exact desired_time is not ' +
        'available the tool does NOT auto-book a different time — it returns the available times so you can pick, ' +
        'unless you pass allow_closest_time:true (which previews the nearest slot). Omit desired_time to preview ' +
        'the first available slot. Resy can list several slots at one time with different seating types ' +
        '(Dining Room / Bar / Patio) and different fees; pass slot_type to target one. ' +
        "confirm:true books ONLY the exact slot a preview showed: pass the preview's time as desired_time, its " +
        'slot_type and its terms_token with confirm:true (without allow_closest_time). If that slot is gone, or ' +
        'its seating type or cancellation/payment terms changed since the preview, nothing is booked and a ' +
        'fresh preview is returned. ' +
        'Before booking, a confirm checks your existing reservations and refuses if you already hold one at ' +
        'this venue on this date (e.g. an earlier call that timed out but went through); pass ' +
        'allow_duplicate:true to book another anyway. ' +
        "Uses the user's default payment method unless payment_method_id is supplied.",
      annotations: {
        ...toolAnnotations({ title: 'Book a Resy reservation', readOnly: false }),
        destructiveHint: true,
      },
      inputSchema: z.object({
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
            'When true, if your exact desired_time is unavailable the preview selects the closest slot instead ' +
              'of returning the available times to pick from. It never books on its own: confirm with that ' +
              "slot's time as desired_time. Default false."
          ),
        slot_type: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Seating type (e.g. 'Dining Room', 'Bar', 'Patio'), matched case-insensitively. Only slots of this " +
              "type are considered. Required with confirm:true — pass the preview's slot_type."
          ),
        terms_token: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The preview's terms_token, required with confirm:true. It fingerprints the slot's seating type and " +
              'cancellation/payment terms; if they changed since the preview, the confirm re-previews instead ' +
              'of booking.'
          ),
        lat: z.number().optional(),
        lng: z.number().optional(),
        payment_method_id: z.number().int().positive().optional(),
        allow_duplicate: z
          .boolean()
          .optional()
          .describe(
            'When true, book even if you already hold a reservation at this venue on this date. Default ' +
              'false: a confirm refuses and lists the existing reservation, so a retry after a timed-out ' +
              'booking cannot book twice.'
          ),
        confirm: schemaConfirm,
      }),
    },
    async ({
      venue_id,
      date,
      party_size,
      desired_time,
      allow_closest_time,
      slot_type,
      terms_token,
      lat,
      lng,
      payment_method_id,
      allow_duplicate,
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
      const availableSlots = slots.map((s) => ({ time: s.time, slot_type: s.type }));
      const selection = selectSlot(slots, desired_time, allow_closest_time === true, slot_type);
      if (!selection.chosen) {
        // The requested slot (time, and seating type when given) is not
        // available and closest was not allowed. Book nothing — in particular
        // not a same-time slot of another type — and hand back the options so
        // the caller makes the choice.
        const wanted = [desired_time, slot_type && `'${slot_type}'`].filter(Boolean).join(' ');
        return minifiedResult({
          preview: true,
          action: 'book',
          booked: false,
          note:
            `Requested slot ${wanted} is not available at this venue on ${date}. Nothing was booked. ` +
            `Re-run with a desired_time and slot_type from available_slots` +
            (desired_time ? `, or pass allow_closest_time: true to preview the nearest slot` : '') +
            ` — then confirm with the new preview's slot_type and terms_token.`,
          venue_id,
          date,
          party_size,
          requested_time: desired_time ?? null,
          requested_slot_type: slot_type ?? null,
          available_times: slots.map((s) => s.time),
          available_slots: availableSlots,
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

      // 5. dry-run preview unless explicitly confirmed AND the confirm names
      //    the exact slot. Everything above is a read; the booking POST below
      //    is the only mutation.
      //
      //    Preview and confirm are separate, stateless calls that each re-fetch
      //    slots, so "first available" or "closest" can resolve to a DIFFERENT
      //    slot at confirm time than the one the user approved (someone takes
      //    the 17:00 table; the confirm quietly books 17:45). A confirm
      //    therefore books only the exact slot the preview showed: its `time`
      //    AND `slot_type` fed back (several seatings share a time), with a
      //    `terms_token` proving the cancellation/payment terms are the ones
      //    the user saw. Anything else is refused with a fresh preview
      //    (fleet-audit#225, #226).
      const termsToken = bookingTermsToken(details.slot_type, details.cancellation, details.payment);
      const termsChanged = terms_token !== undefined && terms_token !== termsToken;
      const confirmable =
        confirm === true &&
        desired_time !== undefined &&
        !selection.isClosest &&
        slot_type !== undefined &&
        sameSlotType(details.slot_type, slot_type) &&
        terms_token !== undefined &&
        !termsChanged;
      if (!confirmable) {
        const refused = confirm === true;
        return minifiedResult({
          preview: true,
          action: 'book',
          booked: false,
          note:
            (refused
              ? termsChanged
                ? `NOT BOOKED — this slot's seating type or cancellation/payment terms changed since your ` +
                  `preview. Review the terms below before confirming. `
                : `NOT BOOKED — confirm: true books only the exact slot a preview showed (desired_time, ` +
                  `slot_type and terms_token), so the slot booked is always the one you approved. `
              : `DRY RUN — nothing was booked. `) +
            `To book this slot, re-run with confirm: true, desired_time: "${chosen.time}", ` +
            `slot_type: "${details.slot_type}" and terms_token: "${termsToken}".` +
            (selection.isClosest
              ? ` NOTE: your requested time ${desired_time} was unavailable, so the CLOSEST slot (${chosen.time}) was selected.`
              : '') +
            cancellationFeeNote(details.cancellation),
          venue_name: details.venue_name,
          venue_url: details.venue_url,
          date,
          time: chosen.time,
          requested_time: desired_time ?? null,
          is_closest_match: selection.isClosest,
          available_times: slots.map((s) => s.time),
          available_slots: availableSlots,
          party_size,
          slot_type: details.slot_type,
          terms_token: termsToken,
          payment_method: { id: payment.id, ...(payment.last4 ? { last4: payment.last4 } : {}) },
          // The terms the card is committed to, straight from /3/details —
          // null means Resy stated none, not that there are none.
          cancellation_policy: details.cancellation,
          payment_terms: details.payment,
        });
      }

      // 6. duplicate guard (read-only): refuse if the user already holds a
      //    reservation here that day — most likely an earlier resy_book whose
      //    response was lost to a timeout but which Resy completed.
      if (allow_duplicate !== true) {
        const existing = await findReservationsAtVenueOnDate(client, venue_id, date);
        if (existing.length > 0) {
          return minifiedResult({
            preview: true,
            action: 'book',
            booked: false,
            note:
              `NOT BOOKED — you already have ${existing.length === 1 ? 'a reservation' : `${existing.length} reservations`} ` +
              `at ${details.venue_name} on ${date} (see existing_reservations). If an earlier resy_book call ` +
              `failed or timed out, it most likely went through. To book another table anyway, re-run with ` +
              `allow_duplicate: true and confirm: true.`,
            venue_name: details.venue_name,
            date,
            time: chosen.time,
            party_size,
            existing_reservations: existing,
          });
        }
      }

      // 7. book (the only mutating call)
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

      return minifiedResult({
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
