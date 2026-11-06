import { defineConfig } from "vitest/config";

/** The Box server `pnpm dev:box` talks to (start it with `pnpm start`). */
const BOX = "http://127.0.0.1:8790";

// The screen is one static page: its root is src/screen, and the build lands in dist/screen. In box mode the dev
// server passes the API and the link through to a running Box server, so the screen is on the same origin as in the
// kiosk.
export default defineConfig({
  root: "src/screen",
  envDir: "../..",
  build: { outDir: "../../dist/screen", emptyOutDir: true, target: "es2023" },
  server: { proxy: { "/api": BOX, "/link": { target: BOX, ws: true } } },
  test: { root: ".", include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
