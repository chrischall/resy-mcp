import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ResyClient } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerUserTools } from '../src/tools/user.js';
import { registerVenueTools } from '../src/tools/venues.js';
import { registerReservationTools } from '../src/tools/reservations.js';
import { registerFavoriteTools } from '../src/tools/favorites.js';
import { registerNotifyTools } from '../src/tools/notify.js';
import { createTestHarness } from './helpers.js';

/**
 * Fleet annotation meta-test: reads the SERVED tool list (every registrar
 * src/index.ts wires, over the in-memory transport) rather than a hand-kept
 * list, so a new tool cannot ship unclassified.
 *
 * `destructiveHint` DEFAULTS TO TRUE whenever readOnlyHint is false, so a write
 * that forgets to declare it is published as destructive and nothing fails —
 * a considered `false` and a forgotten one look identical. Each write must
 * CHOOSE, by the inverse test: `false` only when a later call in this tool set
 * restores the prior state.
 */
interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

let harness: Awaited<ReturnType<typeof createTestHarness>>;
let served: { name: string; annotations?: Ann }[];

beforeAll(async () => {
  const client = { request: vi.fn(), describeCredential: vi.fn() } as unknown as ResyClient;
  harness = await createTestHarness((server) => {
    for (const register of [
      registerUserTools,
      registerHealthcheckTools,
      registerVenueTools,
      registerReservationTools,
      registerFavoriteTools,
      registerNotifyTools,
    ]) {
      register(server, client);
    }
  });
  // The raw client, not harness.listTools(): that helper keeps only name +
  // description, and the annotations are the whole point here.
  served = (await harness.client.listTools()).tools as typeof served;
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe('tool annotations', () => {
  it('covers the full served surface (guards against a registrar being dropped here)', () => {
    expect(served).toHaveLength(15);
  });

  it('sets an explicit boolean readOnlyHint on every tool', () => {
    const missing = served.filter((t) => typeof t.annotations?.readOnlyHint !== 'boolean').map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('sets an explicit boolean destructiveHint on every write', () => {
    const undeclared = served
      .filter((t) => t.annotations?.readOnlyHint === false && typeof t.annotations?.destructiveHint !== 'boolean')
      .map((t) => t.name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', () => {
    const contradictory = served
      .filter((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(contradictory).toEqual([]);
  });

  it('marks every tool open-world (each one calls api.resy.com)', () => {
    const notOpen = served.filter((t) => t.annotations?.openWorldHint !== true).map((t) => t.name);
    expect(notOpen).toEqual([]);
  });

  it('holds the destructive set to the writes with no inverse', () => {
    // resy_book spends a slot and can charge the card (no-show fee / deposit),
    // and resy_cancel gives the table up — neither has an inverse here.
    // Favorites add/remove and notify add/remove are each other's inverses.
    const destructive = served
      .filter((t) => t.annotations?.readOnlyHint === false && t.annotations?.destructiveHint !== false)
      .map((t) => t.name)
      .sort();
    expect(destructive).toEqual(['resy_book', 'resy_cancel']);
  });

  it('keeps manifest.json tools[] identical to the served names', () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
      tools: { name: string }[];
    };
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(served.map((t) => t.name).sort());
  });
});
