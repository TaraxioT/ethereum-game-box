import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The Box's logic runs in memory, so the tests run in Node; `cloudflare:workers` is stubbed to a bare base class.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('../relayer/test/cloudflare-workers.ts', import.meta.url)) },
  },
});
