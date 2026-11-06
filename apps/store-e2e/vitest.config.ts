import { defineConfig } from 'vitest/config';

// One run, one world: a single file, in order, printing each step as it happens. It isn't part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.ts'],
    fileParallelism: false,
    disableConsoleIntercept: true,
    reporters: ['verbose'],
    testTimeout: 10 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
