import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';
import { textResult } from '../mcp.js';

interface RawNotifyEntry {
  specs?: {
    venue_id?: number;
    day?: string;
    party_size?: number;
    time_preferred_start?: string;
    time_preferred_end?: string;
    notify_request_id?: number;
    service_type_id?: number;
  };
}

interface NotifyResponse {
  notify?: RawNotifyEntry[];
}

/**
 * Resy uses HH:MM:SS on the wire; callers see HH:MM.
 */
function trimSeconds(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const m = /^(\d{2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

function padSeconds(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

export function registerNotifyTools(server: McpServer, client: ResyClient): void {
  server.registerTool(
    'resy_list_notify',
    {
      description:
        'List Priority Notify subscriptions — tables you are waiting for when reservations open up.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request<NotifyResponse>('GET', '/3/notify');
      const entries = (data.notify ?? [])
        .map((e) => e.specs)
        .filter((s): s is NonNullable<typeof s> => !!s?.notify_request_id)
        .map((s) => ({
          notify_id: s.notify_request_id,
          venue_id: s.venue_id,
          date: s.day,
          party_size: s.party_size,
          time_start: trimSeconds(s.time_preferred_start),
          time_end: trimSeconds(s.time_preferred_end),
          service_type_id: s.service_type_id,
        }));
      return textResult(entries);
    }
  );

  server.registerTool(
    'resy_add_notify',
    {
      description:
        "Subscribe to Priority Notify for a venue/date/party size. Resy emails you when a matching slot opens. time_start / time_end bound the window you're willing to accept (HH:MM, 24h). Resy's notify booking window only accepts near-term dates (~30 days out).",
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD (must be within Resy\'s notify window, ~30 days)'),
        party_size: z.number().int().positive(),
        time_start: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'time_start must be HH:MM (24h)')
          .optional()
          .describe('Earliest acceptable time, HH:MM. Defaults 18:00.'),
        time_end: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'time_end must be HH:MM (24h)')
          .optional()
          .describe('Latest acceptable time, HH:MM. Defaults 21:00.'),
        service_type_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Resy service type (2 = dining room, observed default)'),
      },
    },
    async ({ venue_id, date, party_size, time_start, time_end, service_type_id }) => {
      const body = new URLSearchParams({
        venue_id: String(venue_id),
        day: date,
        num_seats: String(party_size),
        time_preferred_start: padSeconds(time_start ?? '18:00'),
        time_preferred_end: padSeconds(time_end ?? '21:00'),
        service_type_id: String(service_type_id ?? 2),
      });
      const data = await client.request<Record<string, unknown>>('POST', '/2/notify', body);
      return textResult(data);
    }
  );

  server.registerTool(
    'resy_remove_notify',
    {
      description:
        'Cancel a Priority Notify subscription by notify_id. The tool looks up the full spec from resy_list_notify internally — no other input needed.',
      inputSchema: { notify_id: z.number().int().positive() },
    },
    async ({ notify_id }) => {
      // DELETE /2/notify requires the FULL spec in the query string, not just the id.
      const list = await client.request<NotifyResponse>('GET', '/3/notify');
      const entry = (list.notify ?? [])
        .map((e) => e.specs)
        .find((s) => s?.notify_request_id === notify_id);
      if (!entry) {
        throw new Error(
          `No Priority Notify subscription found with notify_id=${notify_id}. Call resy_list_notify to see current subscriptions.`
        );
      }

      const params = new URLSearchParams({
        notify_request_id: String(notify_id),
        venue_id: String(entry.venue_id ?? ''),
        day: entry.day ?? '',
        num_seats: String(entry.party_size ?? ''),
        service_type_id: String(entry.service_type_id ?? 2),
      });
      await client.request<unknown>('DELETE', `/2/notify?${params.toString()}`);
      return textResult({ removed: true, notify_id });
    }
  );
}
