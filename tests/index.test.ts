import { describe, it, expect, vi, afterAll } from 'vitest';
import type { ResyClient } from '../src/client.js';
import { registerUserTools } from '../src/tools/user.js';
import { registerVenueTools } from '../src/tools/venues.js';
import { registerReservationTools } from '../src/tools/reservations.js';
import { registerFavoriteTools } from '../src/tools/favorites.js';
import { registerNotifyTools } from '../src/tools/notify.js';
import { createTestHarness } from './helpers.js';

// Verify the tool registry covers every expected tool.
// Catches wiring regressions: a rename in one file that isn't mirrored in the
// manifest, or a new tool registration that doesn't ship to the MCP surface.

describe('tool registry', () => {
  const mockClient = { request: vi.fn() } as unknown as ResyClient;

  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('registers all 14 expected tools', async () => {
    harness = await createTestHarness((server) => {
      registerUserTools(server, mockClient);
      registerVenueTools(server, mockClient);
      registerReservationTools(server, mockClient);
      registerFavoriteTools(server, mockClient);
      registerNotifyTools(server, mockClient);
    });

    const tools = await harness.listTools();
    const allNames = tools.map((t) => t.name).sort();

    const expected = [
      // user
      'resy_get_profile',
      'resy_list_payment_methods',
      // venues
      'resy_search_venues',
      'resy_find_slots',
      'resy_get_venue',
      // reservations
      'resy_book',
      'resy_list_reservations',
      'resy_cancel',
      // favorites
      'resy_list_favorites',
      'resy_add_favorite',
      'resy_remove_favorite',
      // priority notify
      'resy_list_notify',
      'resy_add_notify',
      'resy_remove_notify',
    ].sort();

    expect(allNames).toEqual(expected);
    expect(tools).toHaveLength(expected.length);
  });
});
