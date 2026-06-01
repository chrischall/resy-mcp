/**
 * Small helpers for shaping tool responses that the MCP SDK expects.
 *
 * `textResult` now comes from `@chrischall/mcp-utils` (the fleet-shared
 * implementation is byte-identical to the one this file used to define).
 * Re-exported here so the existing `import { textResult } from '../mcp.js'`
 * sites across `src/tools/*` keep working unchanged.
 */
export { textResult } from '@chrischall/mcp-utils';
