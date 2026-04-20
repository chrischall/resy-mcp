import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface RawReservation {
  resy_token?: string;
  token?: string;
  reservation_id?: number;
  id?: number;
  venue?: { name?: string };
  venue_name?: string;
  name?: string;
  date?: string;
  day?: string;
  reservation_date?: string;
  time_slot?: string;
  time?: string;
  start_time?: string;
  num_seats?: number;
  party_size?: number;
  seats?: number;
  config?: { type?: string };
  type?: string;
  status?: string;
}

function formatReservation(r: RawReservation) {
  return {
    resy_token: r.resy_token ?? r.token ?? '',
    reservation_id: r.reservation_id ?? r.id ?? 0,
    venue_name: r.venue?.name ?? r.venue_name ?? r.name ?? 'Unknown',
    date: r.date ?? r.day ?? r.reservation_date ?? '',
    time: r.time_slot ?? r.time ?? r.start_time ?? '',
    party_size: r.num_seats ?? r.party_size ?? r.seats ?? 0,
    type: r.config?.type ?? r.type ?? 'Dining Room',
    status: r.status,
  };
}

export function registerReservationTools(
  server: McpServer,
  client: ResyClient
): void {
  server.registerTool(
    'resy_list_reservations',
    {
      description:
        'List the user\'s Resy reservations. Defaults to upcoming; pass scope="past" or scope="all" to broaden. Each result includes the resy_token needed for cancellation.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        scope: z.enum(['upcoming', 'past', 'all']).optional(),
      },
    },
    async ({ scope }) => {
      const scopeParam = scope ?? 'upcoming';
      const path = `/3/user/reservations?scope=${encodeURIComponent(scopeParam)}`;
      const data = await client.request<{
        reservations?: RawReservation[];
        upcoming?: RawReservation[];
        results?: RawReservation[];
      }>('GET', path);
      const raw = data.reservations ?? data.upcoming ?? data.results ?? [];
      const formatted = raw.map(formatReservation);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
      };
    }
  );

  server.registerTool(
    'resy_cancel',
    {
      description:
        'Cancel a Resy reservation by its resy_token (the rr://... identifier returned from resy_book or resy_list_reservations).',
      inputSchema: {
        resy_token: z.string().describe('rr://... reservation identifier'),
      },
    },
    async ({ resy_token }) => {
      const body = new URLSearchParams({ resy_token });
      const data = await client.request<Record<string, unknown>>(
        'POST',
        '/3/cancel',
        body
      );
      const result = { cancelled: true, raw: data };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
