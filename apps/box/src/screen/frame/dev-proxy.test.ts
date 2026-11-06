// `pnpm dev:box` serves the screen from Vite and passes the Box's own paths through to a running Box server. A frame's
// files are the Box's: any left on Vite is a 404, and a store match then ends `lost` for a page that never loaded.
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../../vite.config.ts";

const FRAME_PATHS = ["/games/tap-three/frame.html", "/parts.js", "/parts.css", "/parts/font.woff2", "/frame.js", "/bundle-host.js", `/store/0x${"ab".repeat(32)}/index.html`];

describe("the dev server", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function proxy() {
    vi.stubEnv("VITE_EGB_MODE", "box");
    return config({ command: "serve", mode: "development" }).server?.proxy ?? {};
  }

  it("passes every path a frame loads through to the Box", () => {
    const prefixes = Object.keys(proxy());
    expect(FRAME_PATHS.filter((path) => !prefixes.some((prefix) => path.startsWith(prefix)))).toEqual([]);
  });

  it("keeps the Host on a frame's page: its CSP names the origin it was asked for, and a string here would rewrite it", () => {
    const { "/games": games, "/store/": store } = proxy();
    expect(games).toMatchObject({ target: expect.any(String) });
    expect(store).toMatchObject({ target: expect.any(String) });
    expect(games).not.toHaveProperty("changeOrigin", true);
    expect(store).not.toHaveProperty("changeOrigin", true);
  });
});
