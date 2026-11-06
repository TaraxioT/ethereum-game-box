import { defineConfig } from 'vitest/config';

// The Worker's logic runs against an in-memory R2, so the tests run in Node. The live test (`test/live`) starts a real
// `wrangler dev --local`, and runs only with LIVE=1.
export default defineConfig({
  test: {
    include: process.env.LIVE ? ['test/live/**/*.test.ts'] : ['test/**/*.test.ts'],
    exclude: process.env.LIVE ? [] : ['test/live/**'],
    setupFiles: ['test/setup.ts'],
    testTimeout: process.env.LIVE ? 120_000 : 5000,
  },
});
