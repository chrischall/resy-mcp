/**
 * `_meta.mint` hints (the mcp-host context-groups contract): which canonical
 * group a tool belongs to, what kind of ask it answers, and the everyday words
 * its name and description lack. Inert data to any other client. The shape is
 * fixed by the host's contract, so it is restated here rather than imported —
 * this server takes no dependency on mcp-host.
 *
 * One canonical read: `resy_list_reservations` answers "what's on?" (the
 * person's upcoming tables). It carries no `subject` — a Resy session is one
 * account, so there is no listable set of subjects to publish — and no `when`,
 * because it takes no date range (only an upcoming/past scope).
 */
const DOMAIN = 'food';

type Intent = 'whats-on' | 'lookup' | 'change';

export interface MintHint {
  domain: typeof DOMAIN;
  intent: Intent;
  canonical?: true;
  aliases?: string[];
}

function foodMeta(intent: Intent, extra: Omit<MintHint, 'domain' | 'intent'> = {}): { mint: MintHint } {
  return { mint: { domain: DOMAIN, intent, ...extra } };
}

/** A read: the profile, cards, venues, slots, favorites, notify list. */
export const LOOKUP_META = foodMeta('lookup');
/** The canonical "what's on": the person's reservations. Lowercase, ≤ 8, each ≤ 40 chars. */
export const RESERVATIONS_META = foodMeta('whats-on', {
  canonical: true,
  aliases: ['reservation', 'reservations', 'dinner', 'restaurant', 'table', 'booking', 'eating out'],
});
/** Booking a table. */
export const BOOK_META = foodMeta('change', { aliases: ['book a table', 'make a reservation', 'table for', 'dinner reservation'] });
/** Cancelling a reservation. */
export const CANCEL_META = foodMeta('change', { aliases: ['cancel my reservation', 'cancel dinner'] });
/** Saving or unsaving a favorite venue. */
export const FAVORITE_META = foodMeta('change', { aliases: ['hit list', 'favorite restaurant'] });
/** Joining or leaving a Priority Notify waitlist. */
export const NOTIFY_META = foodMeta('change', { aliases: ['waitlist', 'notify me', 'priority notify'] });
