import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface RawFavoriteEntry {
  venue?: {
    id?: { resy?: number };
    name?: string;
    type?: string;
    url_slug?: string;
    price_range?: number;
    location?: { locality?: string; region?: string; neighborhood?: string };
  };
}

interface FavoritesResponse {
  results?: { venues?: RawFavoriteEntry[] };
}

export function registerFavoriteTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_favorites',
    {
      description: 'List the user\'s favorited Resy venues ("hit list").',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<FavoritesResponse>('GET', '/3/user/favorites');
      const venues = (data.results?.venues ?? [])
        .map((entry) => entry.venue)
        .filter((v): v is NonNullable<typeof v> => !!v?.id?.resy)
        .map((v) => ({
          venue_id: v.id?.resy,
          name: v.name,
          cuisine: v.type,
          url_slug: v.url_slug,
          price_range: v.price_range,
          city: v.location?.locality,
          state: v.location?.region,
          neighborhood: v.location?.neighborhood,
        }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(venues, null, 2) }] };
    }
  );

  // Add and remove are both POST /3/user/favorites with a toggle flag.
  // (Resy does not use DELETE here; the web app sends favorite=1 or favorite=0.)
  server.registerTool(
    'resy_add_favorite',
    {
      description: 'Add a venue to the user\'s favorites by venue_id.',
      inputSchema: { venue_id: z.number().int().positive() },
    },
    async ({ venue_id }) => {
      const body = new URLSearchParams({ venue_id: String(venue_id), favorite: '1' });
      await client.request<unknown>('POST', '/3/user/favorites', body);
      const out = { favorited: true, venue_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_remove_favorite',
    {
      description: 'Remove a venue from the user\'s favorites by venue_id.',
      inputSchema: { venue_id: z.number().int().positive() },
    },
    async ({ venue_id }) => {
      const body = new URLSearchParams({ venue_id: String(venue_id), favorite: '0' });
      await client.request<unknown>('POST', '/3/user/favorites', body);
      const out = { removed: true, venue_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );
}
