import { defineConfig } from "vitest/config";

// Real bash and a fake model server, so the tests run in Node. `test/docker` needs Docker: `pnpm test:docker`.
export default defineConfig({
  test: { include: ["test/*.test.ts"], testTimeout: 15_000 },
});
