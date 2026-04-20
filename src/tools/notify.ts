import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

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

// Resy sends times as "HH:MM:SS". Normalize to "HH:MM" for caller-facing output.
function trimSeconds(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const m = /^(\d{2}:\d{2})/.exec(t);
  return m ? m[1] : t;
}

// Accept HH:MM from the caller, pad to HH:MM:SS for Resy's wire format.
function padSeconds(t: string): string {
  return /:\d{2}$/.test(t) && t.length === 5 ? `${t}:00` : t;
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
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
    }
  );

  server.registerTool(
    'resy_add_notify',
    {
      description:
        "Subscribe to Priority Notify for a venue/date/party size. Resy emails you when a matching slot opens. time_start / time_end bound the window you're willing to accept (HH:MM, 24h).",
      inputSchema: {
        venue_id: z.number().int().positive(),
        date: z.string().describe('YYYY-MM-DD'),
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
      },
    },
    async ({ venue_id, date, party_size, time_start, time_end }) => {
      const body = new URLSearchParams({
        venue_id: String(venue_id),
        day: date,
        party_size: String(party_size),
        time_preferred_start: padSeconds(time_start ?? '18:00'),
        time_preferred_end: padSeconds(time_end ?? '21:00'),
      });
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
