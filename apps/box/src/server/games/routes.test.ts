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
import { createHandler } from "../routes.ts";
import { CSP } from "../security.ts";
import { createFrameAssets } from "./assets.ts";
import { bundleCsp, frameCsp, withBundleHost } from "./page.ts";
import { createGameRoutes, type GameRoutes } from "./routes.ts";

const gamesDir = path.join(tempDir("egb-game-routes-"), "games");
const TEAM_DIR = new URL("../../games", import.meta.url).pathname;
let base = "";
let server: http.Server;
let routes: GameRoutes;

const HASH =`0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;
const bundleDir = tempDir("egb-bundle-routes-");
const BUNDLE_PAGE = `<!doctype html>\n<html lang="en"><head><title>Tap Rush</title><script>window.mine = 1;</script></head><body></body></html>`;
const LISTED = ["index.html", "game.js", "game.css", "art/my sprite.png", "font.woff2", "sound.mp3", "logo.svg", "other.html"];

function unpackBundle(): void {
  mkdirSync(path.join(bundleDir, "art"));
  for (const file of LISTED) writeFileSync(path.join(bundleDir, file), file === "index.html" ? BUNDLE_PAGE : `the file ${file}`);
  // On the disk, but not in the bundle's list.
  writeFileSync(path.join(bundleDir, "manifest.json"), "{}");
  writeFileSync(path.join(bundleDir, "..", "egb-outside-the-bundle.txt"), "outside");
}

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
  unpackBundle();
  routes = createGameRoutes({
    built: (id) => {
      const e = library.entry(id);
      return e && e.info.kind === "built" && e.dir ? { dir: e.dir, ready: e.info.ready, title: e.info.title } : null;
    },
    bundles: (hash) => (hash === HASH ? { dir: bundleDir, files: new Set(LISTED) } : null),
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

describe("a store bundle's routes", () => {
  const bundled = (file: string, init?: RequestInit) => get(`/store/${HASH}/${file}`, init);

  /** A request with headers `fetch` won't let a caller set. */
  function raw(urlPath: string, headers: http.OutgoingHttpHeaders): Promise<http.IncomingMessage> {
    return new Promise((resolve) => {
      http.get(`${base}${urlPath}`, { headers }, (res) => {
        res.resume();
        resolve(res);
      });
    });
  }

  it("serves index.html under the bundle's own CSP, with inline scripts, no connections and nothing else of the Box's", async () => {
    const res = await bundled("index.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(bundleCsp(base, HASH));
    const directives = new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));
    const own = `${base}/store/${HASH}/`;
    expect(directives.get("default-src")).toBe("'none'");
    expect(directives.get("script-src")).toBe(`${own} ${base}/bundle-host.js 'unsafe-inline'`);
    expect(directives.get("style-src")).toBe(`${own} 'unsafe-inline'`);
    expect(directives.get("font-src")).toBe(own);
    expect(directives.get("media-src")).toBe(own);
    expect(directives.get("img-src")).toBe(`${own} data:`);
    expect(directives.get("connect-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'none'");
    expect(directives.get("frame-ancestors")).toBe(`'self' ${base}`);
    expect(directives.get("sandbox")).toBe("allow-scripts");
    expect(csp).not.toMatch(/unsafe-eval|allow-same-origin|allow-forms|\*/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("puts the host script first and leaves the rest of the page as the game wrote it", async () => {
    const html = await (await bundled("index.html")).text();
    expect(html).toBe(BUNDLE_PAGE.replace("<!doctype html>", '<!doctype html><script src="/bundle-host.js"></script>'));
  });

  it("gets the host in first, whatever the page opens with", () => {
    const host = '<script src="/bundle-host.js"></script>';
    expect(withBundleHost("<html><head></head></html>")).toBe(`${host}<html><head></head></html>`);
    expect(withBundleHost("﻿\n<!DOCTYPE html>x")).toBe(`﻿\n<!DOCTYPE html>${host}x`);
    expect(withBundleHost("<!-- <head> --><script>early()</script>")).toBe(`${host}<!-- <head> --><script>early()</script>`);
    expect(withBundleHost("<script>early()</script><!doctype html>")).toBe(`${host}<script>early()</script><!doctype html>`);
    expect(withBundleHost("")).toBe(host);
  });

  it("serves each listed file unchanged, under the same CSP, readable from the frame's opaque origin", async () => {
    for (const [name, type] of [
      ["game.js", "text/javascript"],
      ["game.css", "text/css"],
      ["art/my%20sprite.png", "image/png"],
      ["font.woff2", "font/woff2"],
      ["sound.mp3", "audio/mpeg"],
      ["logo.svg", "image/svg+xml"],
    ] as const) {
      const res = await bundled(name, { headers: { origin: "null" } });
      expect(res.status, name).toBe(200);
      expect(res.headers.get("content-type"), name).toContain(type);
      expect(res.headers.get("access-control-allow-origin"), name).toBe("*");
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(res.headers.get("content-security-policy"), name).toBe(bundleCsp(base, HASH));
      expect(await res.text(), name).toBe(`the file ${decodeURIComponent(name)}`);
    }
  });

  it("serves nothing the bundle doesn't list, by exact path", async () => {
    for (const file of ["manifest.json", "nothing.js", "index.html/", "INDEX.HTML", "index.htm", "art", "art/", "game.js%00", "%2e%2e/egb-outside-the-bundle.txt", "..%2fegb-outside-the-bundle.txt", "art/../../egb-outside-the-bundle.txt", "%", ""]) {
      expect((await bundled(file)).status, file).toBe(404);
    }
  });

  it("serves nothing for a hash that isn't unpacked, or isn't a hash", async () => {
    for (const urlPath of [`/store/${OTHER_HASH}/index.html`, `/store/${HASH.toUpperCase().replace("0X", "0x")}/index.html`, `/store/${HASH.slice(2)}/index.html`, `/store/${HASH}`, "/store/", "/store/index.html"]) {
      expect((await get(urlPath)).status, urlPath).toBe(404);
    }
  });

  it("lets a frame load only index.html as a page: no game can land it on another", async () => {
    const navigate = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" };
    expect((await raw(`/store/${HASH}/index.html`, navigate)).statusCode).toBe(200);
    for (const file of ["other.html", "logo.svg", "game.js"]) expect((await raw(`/store/${HASH}/${file}`, navigate)).statusCode, file).toBe(404);
    expect((await raw(`/store/${HASH}/game.js`, { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" })).statusCode).toBe(200);
  });

  it("serves a bundle only to this machine, and only to read", async () => {
    expect((await raw(`/store/${HASH}/index.html`, { host: "evil.example:8790" })).statusCode).toBe(400);
    expect((await raw(`/store/${HASH}/game.js`, { host: "evil.example:8790" })).statusCode).toBe(400);
    expect((await bundled("index.html", { method: "POST" })).status).toBe(405);
  });

  it("never gives a bundle's page the launcher token or the Box's CSP", async () => {
    const token = "the-kiosks-own-token";
    const handler = createHandler({ routes: [], games: routes, screenDir: bundleDir, token, log: () => {} });
    const box = http.createServer(handler);
    await new Promise<void>((done) => box.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${(box.address() as AddressInfo).port}`;
    const body = await new Promise<{ res: http.IncomingMessage; text: string }>((resolve) => {
      http.get(`${origin}/store/${HASH}/index.html`, { headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" } }, (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => (text += chunk.toString()));
        res.on("end", () => resolve({ res, text }));
      });
    });
    box.close();
    expect(body.text).not.toContain(token);
    expect(body.res.headers["content-security-policy"]).toBe(bundleCsp(origin, HASH));
    expect(body.res.headers["content-security-policy"]).not.toBe(CSP);
    expect(Object.keys(body.res.headers).filter((name) => name.startsWith("x-egb"))).toEqual([]);
  });

  it("builds the host as a classic script that gives the page window.egb", async () => {
    const res = await get("/bundle-host.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    const host = await res.text();
    expect(host).toContain("egb");
    expect(host).toContain("postMessage");
    expect(host).not.toMatch(/\bimport\b|\bexport\b/);
    expect(host.trimStart().startsWith("(()=>{")).toBe(true);
  });
});
