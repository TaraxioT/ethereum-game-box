import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** The relayer Worker. Its CORS allows only the live sites, so in dev the server passes `/_relayer` through to it. */
const RELAYER = "https://gamebox-relayer.mathew.workers.dev";

const deployments = fileURLToPath(new URL("../../deployments/sepolia.json", import.meta.url));

/** In `--mode e2e` (the Playwright run) the site reads `e2e/deployments.json` in place of `deployments/sepolia.json`:
 *  test addresses, which the test's mock chain answers for. The app code never knows. */
const e2eDeployments = (mode: string) => ({
  name: "e2e-deployments",
  enforce: "pre" as const,
  load(id: string) {
    if (mode !== "e2e" || id.split("?")[0] !== deployments) return null;
    return readFileSync(new URL("e2e/deployments.json", import.meta.url), "utf8");
  },
});

// A static site: the page and its modules under src/, built to dist/ for Cloudflare Pages.
export default defineConfig(({ mode }) => ({
  root: "src",
  envDir: "..",
  plugins: [e2eDeployments(mode)],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023" },
  server: {
    port: 5174,
    proxy: { "/_relayer": { target: RELAYER, changeOrigin: true, rewrite: (path) => path.slice("/_relayer".length) } },
  },
  test: { root: ".", include: ["src/**/*.test.ts"], environment: "node" },
}));
