import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import type { ResyClient } from '../client.js';

/**
 * Register `resy_healthcheck` — reports which of Resy's three mint paths is
 * configured, then makes one authenticated call to `/2/user`.
 *
 * Resy has no persistent bridge: fetchproxy is one of three ways to MINT a
 * token (`/3/auth/refresh` through a signed-in tab), after which every request
 * is a plain API call. So the failures worth telling apart are: no path is
 * configured at all, the configured path minted a token Resy rejects, and Resy
 * being down.
 *
 * `describeCredential()` reads the environment rather than minting, so the
 * healthcheck never spends a login attempt or a bridge round-trip merely to
 * report configuration. The probe does the real mint, so a path that is
 * configured but broken still surfaces — as a rejection, which is the truthful
 * distinction from "not configured".
 */
export function registerHealthcheckTools(server: McpServer, client: ResyClient): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'resy',
    hostLabel: 'api.resy.com',
    probePath: '/2/user',
    resolveCredential: async () => client.describeCredential(),
    probeFn: () => client.request('GET', '/2/user'),
    hints: {
      no_credential:
        'No Resy auth path is configured. Set RESY_EMAIL + RESY_PASSWORD, set RESY_AUTH_TOKEN directly, or install the fetchproxy extension and sign into resy.com (and leave RESY_DISABLE_FETCHPROXY unset).',
      credential_rejected:
        'Resy rejected the minted token. If you are on the password path, check RESY_EMAIL/RESY_PASSWORD; on the fetchproxy path, re-sign in at resy.com so a fresh session can be lifted.',
    },
  });
}
