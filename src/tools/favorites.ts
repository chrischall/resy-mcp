import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

export function registerFavoriteTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_favorites',
    {
      description: 'List the user\'s favorited Resy venues ("hit list").',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<Record<string, unknown>>('GET', '/3/user/favorites');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_add_favorite',
    {
      description: 'Add a venue to the user\'s favorites by venue_id.',
      inputSchema: { venue_id: z.number().int().positive() },
    },
    async ({ venue_id }) => {
      const body = new URLSearchParams({ venue_id: String(venue_id) });
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
      await client.request<unknown>('DELETE', `/3/user/favorites/${venue_id}`);
      const out = { removed: true, venue_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );
}
