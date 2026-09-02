import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerVenueTools, extractHHMM } from '../../src/tools/venues.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('venue tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerVenueTools(server, mockClient));
  });

  describe('extractHHMM', () => {
    // Resy sends `date.start` SPACE-separated ("2026-05-01 19:00:00") on both
    // /3/venuesearch/search and /4/find — not the ISO 'T' form. Verified live.
    it('parses the space-separated form Resy actually sends', () => {
      expect(extractHHMM('2026-05-01 19:00:00')).toBe('19:00');
      expect(extractHHMM('2026-05-01 09:05:00')).toBe('09:05');
    });

    it('still parses the ISO T-separated form', () => {
      expect(extractHHMM('2026-05-01T19:00:00')).toBe('19:00');
    });

    it('still parses a bare time', () => {
      expect(extractHHMM('19:00:00')).toBe('19:00');
    });

    it('returns empty string for missing or unparseable input', () => {
      expect(extractHHMM(undefined)).toBe('');
      expect(extractHHMM('')).toBe('');
      expect(extractHHMM('not a time')).toBe('');
    });
  });

  describe('resy_search_venues', () => {
    it('POSTs form-encoded struct_data with defaults for lat/lng/limit', async () => {
      mockRequest.mockResolvedValue({
        search: {
          hits: [
            {
              id: { resy: 101 },
              name: 'Carbone',
              location: { locality: 'New York', region: 'NY', neighborhood: 'Greenwich Village' },
              cuisine: ['Italian'],
              price_range: 4,
              rating: 4.8,
              url_slug: 'carbone-new-york',
              availability: { slots: [{ config: { token: 'cfg1', type: 'Dining Room' }, date: { start: '2026-05-01 19:00:00' } }] },
            },
          ],
        },
      });

      const result = await harness.callTool('resy_search_venues', {
        query: 'carbone',
        date: '2026-05-01',
        party_size: 2,
      });

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const [method, path, body] = mockRequest.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/3/venuesearch/search');
      expect(body).toBeInstanceOf(URLSearchParams);
      const struct = JSON.parse((body as URLSearchParams).get('struct_data')!);
      expect(struct.slot_filter).toEqual({ day: '2026-05-01', party_size: 2 });
      expect(struct.per_page).toBe(20);
      expect(struct.geo.latitude).toBeCloseTo(40.7128);
      expect(struct.geo.longitude).toBeCloseTo(-73.9876);
      expect(struct.query).toBe('carbone');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"name": "Carbone"');
      expect(text).toContain('"venue_id": 101');
      // City slug is derived from locality+region ("new-york-ny"),
      // matching Resy's canonical URL convention.
      expect(text).toContain('"url": "https://resy.com/cities/new-york-ny/carbone-new-york"');
      expect(text).toContain('"time": "19:00"');
    });

    it('respects explicit lat/lng/limit', async () => {
      mockRequest.mockResolvedValue({ search: { hits: [] } });
      await harness.callTool('resy_search_venues', {
        date: '2026-05-01', party_size: 2,
        lat: 34.0522, lng: -118.2437, limit: 5,
      });
      const [, , body] = mockRequest.mock.calls[0];
      const struct = JSON.parse((body as URLSearchParams).get('struct_data')!);
      expect(struct.geo.latitude).toBeCloseTo(34.0522);
      expect(struct.geo.longitude).toBeCloseTo(-118.2437);
      expect(struct.per_page).toBe(5);
    });
  });

  describe('resy_find_slots', () => {
    it('GETs /4/find with query params and formats slots', async () => {
      mockRequest.mockResolvedValue({
        results: {
          venues: [{
            slots: [
              { config: { token: 'cfg-a', type: 'Dining Room' }, date: { start: '2026-05-01 19:00:00', end: '' } },
              { config: { token: 'cfg-b', type: 'Bar' },         date: { start: '2026-05-01 20:30:00', end: '' } },
            ],
          }],
        },
      });

      const result = await harness.callTool('resy_find_slots', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });

      const [method, path] = mockRequest.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toContain('/4/find?');
      expect(path).toContain('venue_id=101');
      expect(path).toContain('day=2026-05-01');
      expect(path).toContain('party_size=2');
      expect(path).toContain('lat=40.7128');
      expect(path).toContain('long=-73.9876');

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"config_token": "cfg-a"');
      expect(text).toContain('"time": "19:00"');
      expect(text).toContain('"time": "20:30"');
    });

    it('returns empty array when venue has no slots', async () => {
      mockRequest.mockResolvedValue({ results: { venues: [] } });
      const result = await harness.callTool('resy_find_slots', {
        venue_id: 101, date: '2026-05-01', party_size: 2,
      });
      const text = (result.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual([]);
    });
  });

  describe('resy_get_venue', () => {
    it('GETs /3/venue?id=<id>', async () => {
      mockRequest.mockResolvedValue({
        venue: {
          id: { resy: 101 }, name: 'Carbone',
          location: { locality: 'New York', region: 'NY' },
          cuisine: ['Italian'], price_range: 4,
          url_slug: 'carbone-new-york',
        },
      });

      const result = await harness.callTool('resy_get_venue', { venue_id: 101 });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/3/venue?id=101');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"name": "Carbone"');
    });
  });
});
