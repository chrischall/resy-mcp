import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerFavoriteTools } from '../../src/tools/favorites.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('favorite tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerFavoriteTools(server, mockClient));
  });

  it('resy_list_favorites GETs /3/user/favorites and flattens results.venues[].venue', async () => {
    // Real Resy shape (verified via live smoke):
    //   { results: { venues: [ { venue: {...}, is_rga, favorite, ... } ] } }
    mockRequest.mockResolvedValue({
      query: { day: '2026-04-20', party_size: 2 },
      results: {
        venues: [
          {
            venue: {
              id: { resy: 9575 },
              name: "Hank's Seafood",
              type: 'Seafood',
              url_slug: 'hanks-seafood-restaurant',
              price_range: 2,
              location: { locality: 'Charleston', region: 'SC', neighborhood: 'Downtown' },
            },
            is_rga: 0,
            favorite: 1,
          },
          // Entries missing a venue.id.resy should be filtered out defensively.
          { venue: { name: 'Broken entry' } },
        ],
      },
    });
    const result = await harness.callTool('resy_list_favorites');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/3/user/favorites');

    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      venue_id: 9575,
      name: "Hank's Seafood",
      cuisine: 'Seafood',
      url_slug: 'hanks-seafood-restaurant',
      price_range: 2,
      city: 'Charleston',
      state: 'SC',
      neighborhood: 'Downtown',
    });
  });

  it('resy_list_favorites returns [] when user has no favorites', async () => {
    mockRequest.mockResolvedValue({ results: { venues: [] } });
    const result = await harness.callTool('resy_list_favorites');
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual([]);
  });

  it('resy_add_favorite POSTs /3/user/favorites with venue_id', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const result = await harness.callTool('resy_add_favorite', { venue_id: 101 });
    const [method, path, body] = mockRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/3/user/favorites');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('venue_id')).toBe('101');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"favorited": true');
    expect(text).toContain('"venue_id": 101');
  });

  it('resy_remove_favorite DELETEs /3/user/favorites/<id>', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const result = await harness.callTool('resy_remove_favorite', { venue_id: 101 });
    expect(mockRequest).toHaveBeenCalledWith('DELETE', '/3/user/favorites/101');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"removed": true');
  });
});
