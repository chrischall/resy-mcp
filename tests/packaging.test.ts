// Invariant: .claude-plugin/plugin.json declares the MCP config under
// `mcpServers` — the key Claude Code reads. An `mcp` key is silently
// ignored at load time (`claude plugin validate` flags it as an unknown
// field); it only appeared to work here because ./.mcp.json is also the
// default location. Copies of the pattern with a non-default path broke
// plugin installs elsewhere in the fleet.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>;

describe('plugin.json packaging', () => {
  it('declares the MCP config under mcpServers', () => {
    expect(plugin.mcpServers).toBe('./.mcp.json');
  });

  it('has no `mcp` key (Claude Code ignores it)', () => {
    expect(plugin).not.toHaveProperty('mcp');
  });

  it('points mcpServers at a file that exists', () => {
    expect(typeof plugin.mcpServers).toBe('string');
    expect(existsSync(join(ROOT, plugin.mcpServers as string))).toBe(true);
  });
});
