import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Forces the token cache off and pins its path into a temp dir, so no test
    // can reach the developer's real ~/.resy-mcp — see tests/_setup.ts.
    setupFiles: ['./tests/_setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Match the fleet's measured set so these numbers mean the same thing as
      // a sibling repo's: source only, minus the stdio entrypoint.
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      // A RATCHET, not the fleet's 100%. This repo sits at ~97/79/99/98 today,
      // so a 100% gate would fail on arrival and the honest choice is a floor
      // that stops regression now rather than a target that has to be disabled.
      // Set just under the current numbers so ordinary measurement noise does
      // not fail a build, and RAISE THEM when coverage improves — the branch
      // figure in particular is low because several tool handlers
      // (notify.ts:30-49, reservations.ts, venues.ts:96, favorites.ts:30) have
      // untested paths, which is a piece of work in its own right.
      thresholds: { statements: 97, branches: 78, functions: 98, lines: 98 },
    },
  },
});
