#!/usr/bin/env tsx
/**
 * Manual smoke test: hits each tool against real Resy using .env credentials.
 * Run: npm run smoke
 *
 * Read-only operations only — no booking, no cancellation, no favoriting.
 */
import 'dotenv/config';
import { ResyClient } from '../src/client.js';

interface Probe {
  name: string;
  run: (client: ResyClient) => Promise<unknown>;
}

const probes: Probe[] = [
  { name: 'GET /2/user',                run: (c) => c.request('GET', '/2/user') },
  { name: 'GET /3/user/reservations',   run: (c) => c.request('GET', '/3/user/reservations?scope=upcoming') },
  { name: 'GET /3/user/favorites',      run: (c) => c.request('GET', '/3/user/favorites') },
  { name: 'GET /3/user/notify',         run: (c) => c.request('GET', '/3/user/notify') },
];

const client = new ResyClient();

for (const probe of probes) {
  const label = probe.name.padEnd(34);
  try {
    const data = await probe.run(client);
    const preview = JSON.stringify(data).slice(0, 160);
    console.log(`✓ ${label} ${preview}${preview.length === 160 ? '…' : ''}`);
  } catch (err) {
    console.log(`✗ ${label} ${(err as Error).message}`);
  }
}
