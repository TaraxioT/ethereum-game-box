import { existsSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/** The Box server `pnpm dev:box` talks to (start it with `pnpm start`). */
const BOX = "http://127.0.0.1:8790";

/** A request for a file under src/ (a team game's own modules in src/games/) is the dev server's, not the Box's. */
const ownFile = (req: { url?: string }): string | undefined => {
  const path = req.url?.split("?")[0] ?? "";
  return path && existsSync(new URL(`src${path}`, import.meta.url)) ? req.url : undefined;
};

/** Each page's source under src/, and where the Box serves it from: the screen at the root, the test page at /test. */
const PAGES = { "screen/index.html": "index.html", "test-page/index.html": "test/index.html" } as const;
type Page = keyof typeof PAGES;

/**
 * The pages live in their own folders under src/, but the Box serves the screen at / and the test page at /test:
 * the built pages are written there (their assets are linked from the root, so moving the HTML is enough), and the dev
 * server sends / and /test to them.
 */
function pagePaths(): Plugin {
  return {
    name: "egb-page-paths",
    enforce: "post",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const to = req.url === "/" ? "/screen/" : req.url === "/test" || req.url === "/test/" ? "/test-page/" : null;
        if (!to) return next();
        res.writeHead(302, { location: to }).end();
      });
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        const to = PAGES[file.fileName as Page];
        if (to) file.fileName = to;
      }
    },
  };
}

// Two builds from one config: the demo (`pnpm build`) is the screen alone, for any visitor's browser; the Box
// (`pnpm build:box`) adds the test page the Box server serves at /test. Both land in dist/screen. In box mode the dev
// server passes the API and the link through to a running Box server, so the pages are on its origin as in the kiosk.
export default defineConfig(() => {
  const box = process.env.VITE_EGB_MODE === "box";
  const input = Object.keys(PAGES)
    .filter((page) => box || page === "screen/index.html")
    .map((page) => `src/${page}`);
  return {
    root: "src",
    envDir: "..",
    plugins: [pagePaths()],
    build: { outDir: "../dist/screen", emptyOutDir: true, target: "es2023", rollupOptions: { input } },
    // Built games' cartridges and frames are the Box server's too (server/games/): the frame's page, its parts and fonts.
    server: { proxy: { "/api": BOX, "/link": { target: BOX, ws: true }, "/games": { target: BOX, bypass: ownFile }, "/parts": BOX, "/frame.js": BOX } },
    test: { root: ".", include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
  };
});
