import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The Worker's logic runs in memory, so the tests run in Node. `cloudflare:workers` is stubbed, and the real
// `@cloudflare/containers` is inlined so it loads against the stub: the container's rules are tested on the real class.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('test/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    server: { deps: { inline: ['@cloudflare/containers'] } },
  },
});
