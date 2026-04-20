import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';
import { textResult } from '../mcp.js';

export const DEFAULT_LAT = 40.7128;
export const DEFAULT_LNG = -73.9876;
const DEFAULT_RADIUS_M = 16100;

interface RawSlot {
  config?: { token?: string; type?: string };
  date?: { start?: string; end?: string };
}
interface RawVenue {
  id?: { resy?: number };
  name?: string;
  location?: { locality?: string; region?: string; neighborhood?: string; url_slug?: string };
  cuisine?: string[];
  price_range?: number;
  rating?: number;
  url_slug?: string;
  availability?: { slots?: RawSlot[] };
  venue_url_slug?: string;
}

export interface FormattedSlot {
  config_token: string;
  date: string;
  time: string;
  party_size: number;
  type: string;
}

/**
 * Parse "HH:MM" directly from an ISO-ish string like "2026-05-01T19:00:00".
 * Avoids `new Date()` so slot times aren't shifted by the caller's timezone
 * (Resy returns times in the restaurant's local zone with no offset).
 */
export function extractHHMM(start: string | undefined): string {
  const m = /T(\d{2}):(\d{2})/.exec(start ?? '');
  return m ? `${m[1]}:${m[2]}` : '';
}

function formatSlot(raw: RawSlot, day: string, partySize: number): FormattedSlot {
  return {
    config_token: raw.config?.token ?? '',
    date: day,
    time: extractHHMM(raw.date?.start),
    party_size: partySize,
    type: raw.config?.type ?? 'Dining Room',
  };
}

/**
 * Fetch available slots at a venue for a date + party size.
 * Shared between `resy_find_slots` and the first step of `resy_book` so both
 * call Resy the same way.
 */
export async function findSlotsAtVenue(
  client: ResyClient,
  args: {
    venue_id: number;
    date: string;
    party_size: number;
    lat?: number;
    lng?: number;
  }
): Promise<FormattedSlot[]> {
  const params = new URLSearchParams({
    lat: String(args.lat ?? DEFAULT_LAT),
    long: String(args.lng ?? DEFAULT_LNG),
    day: args.date,
    party_size: String(args.party_size),
    venue_id: String(args.venue_id),
  });
  const data = await client.request<{
    results?: { venues?: Array<{ slots?: RawSlot[] }> };
  }>('GET', `/4/find?${params.toString()}`);
  const slots = data.results?.venues?.[0]?.slots ?? [];
  return slots.map((s) => formatSlot(s, args.date, args.party_size));
}

/**
 * Resy's canonical URL is /cities/<city-slug>/<venue-slug>. The city slug
 * follows the "<city>-<state>" convention (e.g. "new-york-ny"). When the raw
 * venue payload carries an explicit `location.url_slug`, prefer it; otherwise
 * derive a best-effort slug from locality + region.
 */
function deriveCitySlug(raw: RawVenue): string {
  if (raw.location?.url_slug) return raw.location.url_slug;
  const locality = raw.location?.locality?.toLowerCase().replace(/\s+/g, '-');
  const region = raw.location?.region?.toLowerCase().replace(/\s+/g, '-');
  if (locality && region) return `${locality}-${region}`;
  return locality ?? 'new-york-ny';
}

function formatVenue(raw: RawVenue, day?: string, partySize?: number) {
  const citySlug = deriveCitySlug(raw);
  const slug = raw.url_slug ?? raw.venue_url_slug ?? '';
  return {
    venue_id: raw.id?.resy,
    name: raw.name,
    location: raw.location
      ? {
          city: raw.location.locality,
          state: raw.location.region,
          neighborhood: raw.location.neighborhood,
        }
      : undefined,
    cuisine: raw.cuisine ?? [],
    price_range: raw.price_range,
    rating: raw.rating,
    url_slug: slug,
    url: slug ? `https://resy.com/cities/${citySlug}/${slug}` : undefined,
    slots:
      day !== undefined && partySize !== undefined
        ? (raw.availability?.slots ?? []).map((s) => formatSlot(s, day, partySize))
        : undefined,
  };
}

export function registerVenueTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_search_venues',
    {
      description:
        'Search Resy for restaurants with availability. Returns venues including any bookable slot tokens for the requested date + party size. Defaults to NYC geo if lat/lng omitted.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().optional().describe('Venue name or keyword'),
        lat: z.number().optional().describe('Latitude (default 40.7128 NYC)'),
        lng: z.number().optional().describe('Longitude (default -73.9876 NYC)'),
        date: z.string().describe('Desired date YYYY-MM-DD'),
        party_size: z.number().int().positive().describe('Number of guests'),
        limit: z.number().int().positive().optional().describe('Max venues (default 20)'),
        radius_meters: z.number().int().positive().optional().describe('Search radius in meters (default 16100)'),
      },
    },
    async ({ query, lat, lng, date, party_size, limit, radius_meters }) => {
      const struct = {
        availability: true,
        page: 1,
        per_page: limit ?? 20,
        slot_filter: { day: date, party_size },
        types: ['venue'],
        order_by: 'availability',
        geo: {
          latitude: lat ?? DEFAULT_LAT,
          longitude: lng ?? DEFAULT_LNG,
          radius: radius_meters ?? DEFAULT_RADIUS_M,
        },
        query: query ?? '',
      };
      const body = new URLSearchParams({ struct_data: JSON.stringify(struct) });
      const data = await client.request<{ search?: { hits?: RawVenue[] } }>(
        'POST',
        '/3/venuesearch/search',
        body
      );
      const hits = data.search?.hits ?? [];
      const formatted = hits
        .filter((h) => h.id?.resy)
        .map((h) => formatVenue(h, date, party_size));
      return textResult(formatted);
    }
  );

  server.registerTool(
    'resy_find_slots',
    {
      description:
        'List available reservation slots at a specific venue for a date + party size. Returns slot config_tokens suitable for booking. Tokens expire quickly; book soon after fetching.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      },
    },
    async (args) => textResult(await findSlotsAtVenue(client, args))
  );

  server.registerTool(
    'resy_get_venue',
    {
      description: 'Get full details for a single Resy venue by id.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        venue_id: z.number().int().positive(),
      },
    },
    async ({ venue_id }) => {
      const data = await client.request<{ venue?: RawVenue }>(
        'GET',
        `/3/venue?id=${venue_id}`
      );
      return textResult(data.venue ? formatVenue(data.venue) : null);
    }
  );
}
