import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Forces the token cache off and pins its path into a temp dir, so no test
    // can reach the developer's real ~/.resy-mcp — see tests/_setup.ts.
    setupFiles: ['./tests/_setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
