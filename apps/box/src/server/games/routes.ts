// The HTTP routes for built games' cartridges and frames, ahead of the screen's own files:
//
//   GET /games/<id>/icon.svg     the cartridge art (any installed built game, sealed or not); one that fails the icon
//                                check is replaced by the Box's plain icon
//   GET /games/<id>/screen.js    the game's screen module (playable games only)
//   GET /games/<id>/frame.html   the frame page, with its own CSP (page.ts) (playable games only)
//   GET /parts.js, /parts.css, /parts/<font>, /frame.js    the frame's shared assets (assets.ts)
//
// The frame's origin is opaque, so everything it loads is a cross-origin request from `null`: module scripts, fonts
// and the screen's import() are fetched in CORS mode and need Access-Control-Allow-Origin: *. None of it is secret;
// the Box's API stays same-origin. Every answer is `nosniff`, and the files a browser could open on their own carry a
// CSP that runs nothing.
import type http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fallbackIcon, ICON_FILE, ICON_MAX_BYTES, iconProblems } from "../../builder/forge/icon.ts";
import { DIST } from "../../builder/forge/install.ts";
import { BUNDLE_FILES } from "../../builder/bundle/paths.ts";
import { sendFile, sendText } from "../http.ts";
import type { FrameAssets } from "./assets.ts";
import { boxOrigin, frameCsp, framePage } from "./page.ts";

/** An installed built game, by id: its folder, whether it may be played, its title. */
export type BuiltLookup = (id: string) => { readonly dir: string; readonly ready: boolean; readonly title: string } | null;

export interface GameRoutesOptions {
  readonly built: BuiltLookup;
  readonly assets: FrameAssets;
}

/** Handles the request if it is one of these routes (true), or leaves it to the next handler (false). */
export type GameRoutes = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean>;

const ASSET_PATHS = new Set(["/parts.js", "/parts.css", "/frame.js"]);
const GAME_FILE = /^\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(icon\.svg|screen\.js|frame\.html)$/;

const BASE = { "x-content-type-options": "nosniff", "cache-control": "no-cache" } as const;
/** For files the frame loads: readable from its opaque origin. */
const SHARED = { ...BASE, "access-control-allow-origin": "*" } as const;
/** For files a browser could also open by themselves: nothing in them runs. */
const INERT = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function createGameRoutes(options: GameRoutesOptions): GameRoutes {
  async function icon(res: http.ServerResponse, dir: string): Promise<void> {
    const svg = await readFile(path.join(dir, ICON_FILE), "utf8").catch(() => null);
    const good = svg !== null && Buffer.byteLength(svg) <= ICON_MAX_BYTES && iconProblems(svg).length === 0 ? svg : fallbackIcon();
    res.writeHead(200, { ...SHARED, "content-type": "image/svg+xml", "content-security-policy": INERT }).end(good);
  }

  return async (req, res, url) => {
    const p = url.pathname;
    const game = GAME_FILE.exec(p);
    if (!game && !ASSET_PATHS.has(p) && !p.startsWith("/parts/") && !p.startsWith("/games/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "method not allowed");
      return true;
    }

    if (!game) {
      const asset = p.startsWith("/games/") ? null : await options.assets.get(p);
      if (!asset) sendText(res, 404, "not found");
      else res.writeHead(200, { ...SHARED, "content-type": asset.type, "content-length": String(asset.body.byteLength) }).end(asset.body);
      return true;
    }

    const [, id = "", file] = game;
    const found = options.built(id);
    if (!found || (file !== ICON_FILE && !found.ready)) {
      sendText(res, 404, "no such game");
      return true;
    }
    if (file === ICON_FILE) {
      await icon(res, found.dir);
    } else if (file === BUNDLE_FILES.screen) {
      if (!(await sendFile(res, path.join(found.dir, DIST, BUNDLE_FILES.screen), { ...SHARED, "content-security-policy": INERT }))) sendText(res, 404, "not found");
    } else {
      const origin = boxOrigin(req.headers.host);
      if (!origin) sendText(res, 400, "a frame is served to this machine only");
      else res.writeHead(200, { ...BASE, "content-type": "text/html; charset=utf-8", "content-security-policy": frameCsp(origin), "referrer-policy": "no-referrer" }).end(framePage(found.title));
    }
    return true;
  };
}
