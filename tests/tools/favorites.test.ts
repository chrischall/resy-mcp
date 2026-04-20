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

  it('resy_list_favorites GETs /3/user/favorites and returns an array', async () => {
    mockRequest.mockResolvedValue({
      favorites: [
        { id: { resy: 101 }, name: 'Carbone', url_slug: 'carbone' },
      ],
    });
    const result = await harness.callTool('resy_list_favorites');
    expect(mockRequest).toHaveBeenCalledWith('GET', '/3/user/favorites');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('"name": "Carbone"');
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
