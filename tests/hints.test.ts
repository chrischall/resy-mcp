import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResyClient } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerUserTools } from '../src/tools/user.js';
import { registerVenueTools } from '../src/tools/venues.js';
import { registerReservationTools } from '../src/tools/reservations.js';
import { registerFavoriteTools } from '../src/tools/favorites.js';
import { registerNotifyTools } from '../src/tools/notify.js';
import { createTestHarness } from './helpers.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * asserted against the SERVED tool list — what a host actually reads.
 */
type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, { enum?: unknown[] }> };
  _meta?: { mint?: Record<string, any> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  resy_get_profile: 'lookup',
  resy_list_payment_methods: 'lookup',
  resy_search_venues: 'lookup',
  resy_find_slots: 'lookup',
  resy_get_venue: 'lookup',
  resy_list_reservations: 'whats-on',
  resy_book: 'change',
  resy_cancel: 'change',
  resy_list_favorites: 'lookup',
  resy_add_favorite: 'change',
  resy_remove_favorite: 'change',
  resy_list_notify: 'lookup',
  resy_add_notify: 'change',
  resy_remove_notify: 'change',
};

const request = vi.fn();
const client = { request, describeCredential: vi.fn() } as unknown as ResyClient;

async function harness() {
  return createTestHarness((server) => {
    for (const register of [
      registerHealthcheckTools, registerUserTools, registerVenueTools,
      registerReservationTools, registerFavoriteTools, registerNotifyTools,
    ]) register(server, client);
  });
}

async function served(): Promise<Listed[]> {
  const h = await harness();
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

beforeEach(() => request.mockReset());

describe('_meta.mint on tools/list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await served()).map((t) => t.name).filter((n) => n !== 'resy_healthcheck');
    expect(names.sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
  });

  it('leaves only the mcp-utils healthcheck unhinted', async () => {
    const unhinted = (await served()).filter((t) => !t._meta?.mint).map((t) => t.name);
    expect(unhinted).toEqual(['resy_healthcheck']);
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s is in the food group with intent %s', async (name, intent) => {
    const mint = (await served()).find((t) => t.name === name)?._meta?.mint;
    expect(mint).toBeDefined();
    expect(mint!.domain).toBe('food');
    expect(mint!.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await served()) {
      const m = t._meta?.mint;
      if (!m) continue;
      expect(Object.keys(m).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(m.domain);
      expect(INTENTS, t.name).toContain(m.intent);
      const props = t.inputSchema.properties ?? {};
      if ('canonical' in m) {
        expect(m.canonical, t.name).toBe(true);
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(CANONICAL_INTENTS, t.name).toContain(m.intent);
      }
      if ('subject' in m) expect(props, t.name).toHaveProperty(m.subject);
      if ('when' in m) {
        expect(Object.keys(m.when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(m.when.start);
        expect(props, t.name).toHaveProperty(m.when.end);
      }
      if ('aliases' in m) {
        expect(m.aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of m.aliases as string[]) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('has at most one canonical read per whats-new / whats-due / whats-on', async () => {
    const canonical = (await served()).filter((t) => t._meta?.mint?.canonical === true);
    for (const intent of CANONICAL_INTENTS) {
      expect(canonical.filter((t) => t._meta!.mint!.intent === intent).length, intent).toBeLessThanOrEqual(1);
    }
    expect(canonical.map((t) => t.name)).toEqual(['resy_list_reservations']);
  });

  it('the reservations read is the canonical whats-on, with no subject (one account) and no range', async () => {
    const t = (await served()).find((x) => x.name === 'resy_list_reservations')!;
    expect(t._meta?.mint).toEqual({
      domain: 'food',
      intent: 'whats-on',
      canonical: true,
      aliases: ['reservation', 'reservations', 'dinner', 'restaurant', 'table', 'booking', 'eating out'],
    });
    expect(t.inputSchema.properties?.view?.enum).toEqual(['full', 'brief']);
  });
});

describe('resy_list_reservations view: brief', () => {
  const BRIEF = /^.+ — (\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?|no date) — .+$/;

  /** The brief answer's envelope: venue names are third-party text. */
  const envelope = (result: { content: unknown[] }) =>
    JSON.parse((result.content[0] as { text: string }).text) as {
      untrusted_content: boolean;
      note: string;
      data: string[];
    };
  const briefLines = (result: { content: unknown[] }) => envelope(result).data;

  it('answers one line per reservation, ≤ 120 chars, title — ISO date — status', async () => {
    request.mockResolvedValue({
      reservations: [
        { resy_token: 'rr://a', venue: { id: 1 }, day: '2099-12-31', time_slot: '19:30:00', num_seats: 2 },
        { resy_token: 'rr://b', venue: { id: 2 }, day: '2099-12-30', time_slot: '18:00:00', num_seats: 4 },
      ],
      venues: { '1': { name: 'Test Bistro' }, '2': { name: 'Sample Grill' } },
    });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', { view: 'brief' });
    await h.close();
    const lines = briefLines(result);
    expect(lines).toEqual([
      'Test Bistro 19:30, party of 2 — 2099-12-31T19:30 — booked',
      'Sample Grill 18:00, party of 4 — 2099-12-30T18:00 — booked',
    ]);
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(120);
      expect(l).toMatch(BRIEF);
    }
  });

  it('says "no date" when Resy omits the day, marks past ones, and shortens a long venue name to fit', async () => {
    request.mockResolvedValue({
      reservations: [
        { resy_token: 'rr://a', venue: { id: 1 }, num_seats: 2 },
        { resy_token: 'rr://b', venue: { id: 2 }, day: '2000-01-01', time_slot: '20:00:00', num_seats: 3 },
      ],
      venues: { '1': { name: 'X'.repeat(200) }, '2': { name: 'Old Place' } },
    });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', { view: 'brief', scope: 'all' });
    await h.close();
    const lines = briefLines(result);
    expect(lines).toHaveLength(2);
    expect(lines[0].length).toBeLessThanOrEqual(120);
    expect(lines[0]).toMatch(/…, party of 2 — no date — booked$/);
    expect(lines[1]).toBe('Old Place 20:00, party of 3 — 2000-01-01T20:00 — past');
    for (const l of lines) expect(l).toMatch(BRIEF);
  });

  it('rides inside the untrusted-data envelope, minified, note first', async () => {
    request.mockResolvedValue({
      reservations: [{ resy_token: 'rr://a', venue: { id: 1 }, day: '2099-12-31', time_slot: '19:30:00', num_seats: 2 }],
      venues: { '1': { name: 'Test Bistro' } },
    });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', { view: 'brief' });
    await h.close();
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain('\n');
    expect(Object.keys(JSON.parse(text))).toEqual(['untrusted_content', 'note', 'data']);
    const env = envelope(result);
    expect(env.untrusted_content).toBe(true);
    expect(env.note).toMatch(/venue/i);
    expect(env.data).toEqual(['Test Bistro 19:30, party of 2 — 2099-12-31T19:30 — booked']);
  });

  it('answers the single note line "-- none" when there are no reservations', async () => {
    request.mockResolvedValue({ reservations: [], venues: {} });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', { view: 'brief' });
    await h.close();
    expect(briefLines(result)).toEqual(['-- none']);
  });

  it('escapes a venue name that starts with "-- " or "\\" with one leading backslash, and still fits 120', async () => {
    request.mockResolvedValue({
      reservations: [
        { resy_token: 'rr://a', venue: { id: 1 }, day: '2099-12-31', time_slot: '19:30:00', num_seats: 2 },
        { resy_token: 'rr://b', venue: { id: 2 }, day: '2099-12-30', time_slot: '18:00:00', num_seats: 4 },
        { resy_token: 'rr://c', venue: { id: 3 }, day: '2099-12-29', time_slot: '18:00:00', num_seats: 4 },
      ],
      venues: { '1': { name: '-- none' }, '2': { name: '\\Slash Bar' }, '3': { name: '-- ' + 'Y'.repeat(200) } },
    });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', { view: 'brief' });
    await h.close();
    const lines = briefLines(result);
    expect(lines[0]).toBe('\\-- none 19:30, party of 2 — 2099-12-31T19:30 — booked');
    expect(lines[1]).toBe('\\\\Slash Bar 18:00, party of 4 — 2099-12-30T18:00 — booked');
    expect(lines[2].startsWith('\\-- YYY')).toBe(true);
    expect(lines[2]).toMatch(/… 18:00, party of 4 — 2099-12-29T18:00 — booked$/);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(120);
  });

  it('keeps the full JSON answer by default', async () => {
    request.mockResolvedValue({
      reservations: [{ resy_token: 'rr://a', venue: { id: 1 }, day: '2099-12-31', time_slot: '19:30:00', num_seats: 2 }],
      venues: { '1': { name: 'Test Bistro' } },
    });
    const h = await harness();
    const result = await h.callTool('resy_list_reservations', {});
    await h.close();
    expect(JSON.parse((result.content[0] as { text: string }).text)[0].venue_name).toBe('Test Bistro');
  });
});
