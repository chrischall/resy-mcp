// Invariant: every `// x-release-please-version` annotation in src/
// must hold a version string that matches package.json's `version`.
//
// Why this exists: a recurring class of bug where a VERSION constant
// (used as the MCP server's self-reported version + as the fetchproxy
// bridge identity) drifts from package.json because release-please's
// `extra-files` registration lacks the marker — so release-please
// silently skips bumping it on each release. resy-mcp v0.2.0 and
// opentable-mcp every release since v0.9.1 hit this.
//
// This test catches it at CI time. The walk/match/assert logic now lives
// in `@chrischall/mcp-utils/test` as `versionSyncTest` (fleet-shared, and
// behavior-identical: same `x-release-please-version` marker, same semver
// literal regex, same skip of marker lines that carry no version literal).
// If a future contributor registers a new version-bearing constant, just
// add the `x-release-please-version` comment to the line — this test starts
// asserting it automatically.
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version sync', () => {
  it('every `x-release-please-version` annotation matches package.json', () => {
    const mismatches = versionSyncTest({
      srcDir: join(ROOT, 'src'),
      pkgPath: join(ROOT, 'package.json'),
    });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
