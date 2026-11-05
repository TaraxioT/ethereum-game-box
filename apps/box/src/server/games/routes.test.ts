// The built games' routes on a real HTTP server, over a library with a bundled built game installed: the frame page's
// CSP, CORS on everything the frame loads, the icon check, and what a sealed or unknown game gets.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleGame } from "../../builder/bundle/bundle.ts";
import { sdkPaths } from "../../builder/bundle/paths.ts";
import { fallbackIcon } from "../../builder/forge/icon.ts";
import { FIXTURES, tempDir } from "../../builder/forge/test-helpers.ts";
import { createLibrary } from "../library/library.ts";
import { createFrameAssets } from "./assets.ts";
import { frameCsp } from "./page.ts";
import { createGameRoutes } from "./routes.ts";

const gamesDir = path.join(tempDir("egb-game-routes-"), "games");
const TEAM_DIR = new URL("../../games", import.meta.url).pathname;
let base = "";
let server: http.Server;

/** Installs the tap-three fixture as a built game called `id`, bundled for real. */
async function install(id: string, over: { icon?: string; dist?: boolean } = {}): Promise<string> {
  const dir = path.join(gamesDir, id);
  cpSync(path.join(FIXTURES, "tap-three"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(dir, "game.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(path.join(dir, "game.json"), JSON.stringify({ ...manifest, id, title: "Tap <Three>", kind: "built", forge: undefined }));
  if (over.icon) writeFileSync(path.join(dir, "icon.svg"), over.icon);
  if (over.dist !== false) expect((await bundleGame(dir, path.join(dir, "dist"), sdkPaths())).errors).toEqual([]);
  else mkdirSync(path.join(dir, "dist"));
  return dir;
}

beforeAll(async () => {
  await install("tap-three");
  await install("bad-icon", { icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><script>alert(1)</script></svg>` });
  await install("sealed", { dist: false });
  const library = createLibrary({ teamDir: TEAM_DIR, gamesDir, log: () => {} });
  await library.rescan();
  const routes = createGameRoutes({
    built: (id) => {
      const e = library.entry(id);
      return e && e.info.kind === "built" && e.dir ? { dir: e.dir, ready: e.info.ready, title: e.info.title } : null;
    },
    assets: createFrameAssets(() => {}),
  });
  server = http.createServer((req, res) => {
    void routes(req, res, new URL(req.url ?? "/", "http://box")).then((handled) => handled || res.writeHead(418).end());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(() => {
  server.close();
});

function get(urlPath: string, init?: RequestInit) {
  return fetch(`${base}${urlPath}`, init);
}

describe("the built games' routes", () => {
  it("serves the frame page under its own CSP: scripts from the Box only, no connections, framed only by the Box", async () => {
    const res = await get("/games/tap-three/frame.html");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(frameCsp(base));
    const directives = new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));
    expect(directives.get("default-src")).toBe("'none'");
    expect(directives.get("script-src")).toBe(base);
    expect(directives.get("connect-src")).toBe("'none'");
    expect(directives.get("img-src")).toBe(`${base} data:`);
    expect(directives.get("frame-ancestors")).toBe(`'self' ${base}`);
    expect(directives.get("sandbox")).toBe("allow-scripts");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain(`<title>Tap &#60;Three&#62;</title>`);
    expect(html.match(/<script[^>]*>/g)).toEqual(['<script type="module" src="/parts.js">', '<script type="module" src="/frame.js">']);
    expect(html).toContain('<link rel="stylesheet" href="/parts.css">');
  });

  it("serves a frame page only to this machine", async () => {
    const status = await new Promise<number>((resolve) => {
      http.get(`${base}/games/tap-three/frame.html`, { headers: { host: "evil.example:8790" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
    });
    expect(status).toBe(400);
  });

  it("serves everything the frame loads with Access-Control-Allow-Origin: * (its origin is opaque)", async () => {
    const css = await get("/parts.css");
    const font = /url\("?\.\/(parts\/[^)"]+\.woff2)"?\)/.exec(await css.text())?.[1];
    expect(font).toBeTruthy();
    for (const [urlPath, type] of [
      ["/games/tap-three/icon.svg", "image/svg+xml"],
      ["/games/tap-three/screen.js", "text/javascript"],
      ["/parts.js", "text/javascript"],
      ["/parts.css", "text/css"],
      ["/frame.js", "text/javascript"],
      [`/${font}`, "font/woff2"],
    ] as const) {
      const res = await get(urlPath, { headers: { origin: "null" } });
      expect(res.status, urlPath).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), urlPath).toBe("*");
      expect(res.headers.get("content-type"), urlPath).toContain(type);
      expect(res.headers.get("x-content-type-options"), urlPath).toBe("nosniff");
    }
  });

  it("builds the parts to define themselves, and the frame's program to load screen.js and post to the kiosk", async () => {
    const parts = await (await get("/parts.js")).text();
    expect(parts).toContain("customElements.define");
    for (const tag of ["egb-seg", "egb-plate", "egb-key", "egb-fact"]) expect(parts).toContain(tag);
    expect(parts).not.toContain("egb-cart");
    const frame = await (await get("/frame.js")).text();
    expect(frame).toContain("screen.js");
    expect(frame).toContain("postMessage");
    const screen = await (await get("/games/tap-three/screen.js")).text();
    expect(screen).toMatch(/export\s*\{[^}]*as default/);
  });

  it("replaces an icon that fails the check with the Box's plain one, and runs nothing in either", async () => {
    const good = await get("/games/tap-three/icon.svg");
    expect(await good.text()).toBe(readFileSync(path.join(FIXTURES, "tap-three", "icon.svg"), "utf8"));
    expect(good.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(await (await get("/games/bad-icon/icon.svg")).text()).toBe(fallbackIcon());
  });

  it("shows a sealed game's art but never its screen; anything else is not a built game", async () => {
    expect((await get("/games/sealed/icon.svg")).status).toBe(200);
    expect((await get("/games/sealed/frame.html")).status).toBe(404);
    expect((await get("/games/sealed/screen.js")).status).toBe(404);
    expect((await get("/games/quick-draw/icon.svg")).status).toBe(404);
    expect((await get("/games/nowhere/frame.html")).status).toBe(404);
    expect((await get("/games/tap-three/rules.js")).status).toBe(404);
    expect((await get("/games/tap-three/../../etc/passwd")).status).toBe(418);
    expect((await get("/parts/nothing.woff2")).status).toBe(404);
    expect((await get("/games/tap-three/frame.html", { method: "POST" })).status).toBe(405);
    expect((await get("/index.html")).status).toBe(418);
  });
});
