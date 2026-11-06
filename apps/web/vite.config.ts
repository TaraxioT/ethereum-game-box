import { defineConfig } from "vitest/config";

/** The Workers the site calls. Their CORS allows only the live site, so in dev the server passes these through. */
const RELAYER = "https://gamebox-relayer.mathew.workers.dev";
const DEMO_BOX = "https://gamebox-demo-box.mathew.workers.dev";

const through = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  rewrite: (path: string) => path.slice(prefix.length),
});

// A static site: the page and its modules under src/, built to dist/ for Cloudflare Pages.
export default defineConfig({
  root: "src",
  envDir: "..",
  build: { outDir: "../dist", emptyOutDir: true, target: "es2023" },
  server: { proxy: { "/relayer": through(RELAYER, "/relayer"), "/demo-box": through(DEMO_BOX, "/demo-box") } },
  test: { root: ".", include: ["src/**/*.test.ts"], environment: "node" },
});
