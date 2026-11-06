import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The sender's logic runs in memory, so the tests run in Node; `cloudflare:workers` is stubbed to a bare base class.
// The live smoke test (`test/live`) runs only with LIVE=1.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('test/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    include: process.env.LIVE ? ['test/live/**/*.test.ts'] : ['test/**/*.test.ts'],
    exclude: process.env.LIVE ? [] : ['test/live/**'],
    testTimeout: process.env.LIVE ? 15 * 60_000 : 5000,
  },
});
