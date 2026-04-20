import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResyClient } from '../client.js';

interface RawPaymentMethod {
  id?: number;
  brand?: string;
  display_number?: string;
  last_four?: string;
  last4?: string;
  is_default?: boolean;
  exp_month?: number;
  exp_year?: number;
}

interface ResyUser {
  first_name?: string;
  last_name?: string;
  em_address?: string;
  mobile_number?: string;
  num_bookings?: number;
  date_created?: string;
  resy_select?: boolean;
  profile_image_url?: string;
  payment_methods?: RawPaymentMethod[];
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

  server.registerTool('resy_list_payment_methods', {
    description: "List the user's saved payment methods on Resy. Returns id, brand, last four digits, expiry, and is_default. The id can be passed as payment_method_id to resy_book.",
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.request<ResyUser>('GET', '/2/user');
    const methods = (data.payment_methods ?? []).map((m) => ({
      id: m.id,
      brand: m.brand,
      last_four: m.last_four ?? m.last4 ?? m.display_number,
      exp_month: m.exp_month,
      exp_year: m.exp_year,
      is_default: m.is_default ?? false,
    }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(methods, null, 2) }] };
  });
}
