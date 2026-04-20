import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface ResyUser {
  first_name?: string;
  last_name?: string;
  em_address?: string;
  mobile_number?: string;
  num_bookings?: number;
  date_created?: string;
  resy_select?: boolean;
  profile_image_url?: string;
}

export function registerUserTools(server: McpServer, client: ResyClient): void {
  server.registerTool('resy_get_profile', {
    description: "Get the authenticated Resy user's profile (name, email, phone, booking count, member-since date). Payment method IDs are not exposed.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.request<ResyUser>('GET', '/2/user');
    const profile = {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.em_address,
      phone: data.mobile_number,
      num_bookings: data.num_bookings,
      member_since: data.date_created,
      is_resy_select: data.resy_select,
      profile_image_url: data.profile_image_url,
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }] };
  });
}
