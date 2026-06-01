/**
 * In-memory MCP test harness.
 *
 * Now re-exported from `@chrischall/mcp-utils/test` — the fleet-shared
 * implementation is behavior-identical to the one this file used to define
 * (a connected `McpServer` + `Client` pair over `InMemoryTransport`, with
 * `callTool` / `listTools` / `close`). Re-exporting keeps every
 * `import { createTestHarness } from '../helpers.js'` site working unchanged.
 */
export { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
