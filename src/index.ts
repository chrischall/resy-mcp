#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { ResyClient } from './client.js';
import { registerUserTools } from './tools/user.js';
import { registerVenueTools } from './tools/venues.js';
import { registerReservationTools } from './tools/reservations.js';
import { registerFavoriteTools } from './tools/favorites.js';
import { registerNotifyTools } from './tools/notify.js';

// Build the client before boot so the deferred-config-error pattern is
// preserved: the server connects and answers tools/list with no creds, and
// the first tool call surfaces the auth error (ResyClient resolves a token
// lazily on first request). runMcp prints the banner to stderr, registers
// every tool group, installs SIGINT/SIGTERM handlers, and connects stdio.
const client = new ResyClient();

await runMcp<ResyClient>({
  name: 'resy-mcp',
  version: '0.7.0', // x-release-please-version
  deps: client,
  banner:
    '[resy-mcp] This project was developed and is maintained by AI (Claude Opus 4.7). Use at your own discretion.',
  tools: [
    registerUserTools,
    registerVenueTools,
    registerReservationTools,
    registerFavoriteTools,
    registerNotifyTools,
  ],
});
