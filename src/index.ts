#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ResyClient } from './client.js';
import { registerUserTools } from './tools/user.js';
import { registerVenueTools } from './tools/venues.js';
import { registerReservationTools } from './tools/reservations.js';
import { registerFavoriteTools } from './tools/favorites.js';
import { registerNotifyTools } from './tools/notify.js';

const client = new ResyClient();
const server = new McpServer({ name: 'resy-mcp', version: '0.1.2' });

registerUserTools(server, client);
registerVenueTools(server, client);
registerReservationTools(server, client);
registerFavoriteTools(server, client);
registerNotifyTools(server, client);

console.error(
  '[resy-mcp] This project was developed and is maintained by AI (Claude Opus 4.7). Use at your own discretion.'
);

const transport = new StdioServerTransport();
await server.connect(transport);
