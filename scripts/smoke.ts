#!/usr/bin/env tsx
/**
 * Manual smoke test against real Resy using .env credentials.
 * Run: npm run smoke
 *
 * Read-only operations only — no booking, no cancellation, no favoriting.
 *
 * Two sections, answering two different questions:
 *
 *   1. TRANSPORT — does `ResyClient.request` reach Resy and come back 2xx?
 *      Raw endpoint hits. This is what catches an auth break (a 401/403, an
 *      expired token, a blocked egress IP).
 *
 *   2. TOOL LAYER — do the registered tools return CORRECT data? These run the
 *      real tool handlers through the in-memory MCP harness against live Resy
 *      and assert on the output. Section 1 cannot catch a formatting bug: it
 *      never executes a tool handler, and a malformed field still arrives 200.
 *      That gap shipped `"time": ""` on every slot (fixed in 0.9.1) — search
 *      and find were both absent from section 1, and nothing asserted anyway.
 */
import 'dotenv/config';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { ResyClient } from '../src/client.js';
import { registerVenueTools } from '../src/tools/venues.js';

const client = new ResyClient();
let failures = 0;

const label = (s: string) => s.padEnd(34);

function pass(name: string, detail: string) {
  console.log(`✓ ${label(name)} ${detail}`);
}
function warn(name: string, detail: string) {
  console.log(`⚠ ${label(name)} ${detail}`);
}
function fail(name: string, detail: string) {
  failures += 1;
  console.log(`✗ ${label(name)} ${detail}`);
}

/* ── 1. transport ─────────────────────────────────────────────────────── */

const endpoints = [
  'GET /2/user',
  'GET /3/user/reservations',
  'GET /3/user/favorites',
  'GET /3/notify',
] as const;

console.log('transport — raw endpoints reachable and authenticated');
for (const probe of endpoints) {
  const [method, path] = probe.split(' ');
  try {
    const data = await client.request(method!, path!);
    const preview = JSON.stringify(data).slice(0, 120);
    pass(probe, `${preview}${preview.length === 120 ? '…' : ''}`);
  } catch (err) {
    fail(probe, (err as Error).message);
  }
}

/* ── 2. tool layer ────────────────────────────────────────────────────── */

interface Slot { config_token: string; date: string; time: string; type: string }
interface Venue { venue_id: number; name: string; slots?: Slot[] }

const HHMM = /^\d{2}:\d{2}$/;

/**
 * The invariant the 0.9.1 bug violated: a slot that EXISTS must carry a
 * parseable `HH:MM`. Zero slots is a legitimate answer (everything booked), so
 * it warns rather than fails — it means the check could not run, which is not
 * the same as the check passing.
 */
function checkSlotTimes(name: string, slots: Slot[], context: string) {
  if (slots.length === 0) {
    warn(name, `no slots ${context} — nothing to verify (not a failure)`);
    return;
  }
  const bad = slots.filter((s) => !HHMM.test(s.time));
  if (bad.length > 0) {
    fail(
      name,
      `${bad.length}/${slots.length} slots have an unparseable time ` +
        `(e.g. ${JSON.stringify(bad[0]!.time)} on ${bad[0]!.config_token})`
    );
    return;
  }
  const sample = slots.slice(0, 4).map((s) => s.time).join(' ');
  pass(name, `${slots.length} slots, all HH:MM — ${sample}…`);
}

const day = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);

console.log(`\ntool layer — real handlers against live Resy (day ${day}, party 2)`);
const harness = await createTestHarness((server) => registerVenueTools(server, client));

try {
  let searchVenues: Venue[] = [];

  // resy_search_venues — exercises formatVenue + formatSlot + extractHHMM.
  try {
    const result = await harness.callTool('resy_search_venues', {
      date: day,
      party_size: 2,
      limit: 10,
    });
    if (result.isError) throw new Error((result.content[0] as { text: string }).text);
    searchVenues = JSON.parse((result.content[0] as { text: string }).text) as Venue[];

    if (searchVenues.length === 0) {
      warn('resy_search_venues', 'returned no venues — cannot verify formatting');
    } else {
      pass('resy_search_venues', `${searchVenues.length} venues, first: ${searchVenues[0]!.name}`);
      const slots = searchVenues.flatMap((v) => v.slots ?? []);
      checkSlotTimes('  └ slot times', slots, 'across search results');
    }
  } catch (err) {
    fail('resy_search_venues', (err as Error).message);
  }

  // resy_find_slots — same formatting path, different endpoint (/4/find).
  // Targets a venue search just told us has availability, so the check does
  // not go vacuous against a hardcoded id that has since gone dark.
  const target = searchVenues.find((v) => (v.slots ?? []).length > 0) ?? searchVenues[0];
  if (!target) {
    warn('resy_find_slots', 'no venue from search to target — skipped');
  } else {
    try {
      const result = await harness.callTool('resy_find_slots', {
        venue_id: target.venue_id,
        date: day,
        party_size: 2,
      });
      if (result.isError) throw new Error((result.content[0] as { text: string }).text);
      const slots = JSON.parse((result.content[0] as { text: string }).text) as Slot[];
      pass('resy_find_slots', `venue ${target.venue_id} (${target.name})`);
      checkSlotTimes('  └ slot times', slots, `at venue ${target.venue_id}`);
    } catch (err) {
      fail('resy_find_slots', (err as Error).message);
    }
  }
} finally {
  await harness.close();
}

console.log(
  failures === 0
    ? '\nall probes passed'
    : `\n${failures} probe(s) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
