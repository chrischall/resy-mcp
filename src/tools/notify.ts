import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

export function registerNotifyTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_notify',
    {
      description:
        'List Priority Notify subscriptions — tables you are waiting for when reservations open up.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<unknown>('GET', '/3/user/notify');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_add_notify',
    {
      description:
        'Subscribe to Priority Notify for a venue/date/party size. Resy will email when a matching slot opens. time_filter is optional ("HH:MM-HH:MM" window).',
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
        party_size: z.number().int().positive(),
        time_filter: z.string().optional().describe('HH:MM-HH:MM'),
      },
    },
    async ({ venue_id, date, party_size, time_filter }) => {
      const params: Record<string, string> = {
        venue_id: String(venue_id),
        day: date,
        party_size: String(party_size),
      };
      if (time_filter !== undefined) params.time_filter = time_filter;
      const body = new URLSearchParams(params);
      const data = await client.request<Record<string, unknown>>('POST', '/3/notify', body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_remove_notify',
    {
      description: 'Cancel a Priority Notify subscription by notify_id.',
      inputSchema: { notify_id: z.number().int().positive() },
    },
    async ({ notify_id }) => {
      await client.request<unknown>('DELETE', `/3/notify/${notify_id}`);
      const out = { removed: true, notify_id };
      return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }] };
    }
  );
}
