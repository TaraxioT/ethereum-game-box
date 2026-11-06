// HTTP plumbing: the loopback-host and same-origin rules, static files, capped JSON bodies, plain replies.
import type http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

export const mimeOf = (file: string): string => MIME[extname(file).toLowerCase()] ?? "application/octet-stream";

/** JSON bodies are capped at this many bytes. */
export const JSON_LIMIT = 64 * 1024;

/** This machine's names, with any port: what a Host header may say. */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/**
 * The request was addressed to this machine by name. The Box listens on 127.0.0.1 only, but a page on any site can
 * point its own name at 127.0.0.1 (DNS rebinding) and then read the Box as its own origin: its requests carry that
 * name as their Host, so every request and every upgrade with another Host is refused.
 */
export function loopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOST.test(host.toLowerCase());
}

/**
 * Only the Box's own pages may change anything: any page the kiosk browser might open, another local server's
 * included, could otherwise POST to the Box. The Origin must be the very origin the request was sent to (`http://`
 * and its Host, port and all): the Box's port, or the dev server's when it passes a page's requests through. A
 * request with no Origin (curl, the deploy's updater, tests) is allowed: browsers always send one on a POST and on a
 * WebSocket upgrade.
 */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  return loopbackHost(host) && origin.toLowerCase() === `http://${host?.toLowerCase()}`;
}

/**
 * Only the Box's own pages may run a route, even one that only reads: a store game's prerender is a GET to any local URL
 * that no CSP stops. The game can't read the answer, but the route would run. `Sec-Fetch-Site` is one header a page can't
 * set. A browser says `same-origin` for the Box's own pages and `none` for the address bar; curl and the deploy's updater
 * say nothing.
 */
export function ownRequest(site: string | string[] | undefined): boolean {
  return site === undefined || site === "same-origin" || site === "none";
}

/** Resolves `pathname` inside `rootDir`; null when it would escape it, or is malformed. */
export function within(rootDir: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const root = resolve(rootDir);
  const file = resolve(join(root, rel));
  // A trailing separator, so a sibling like "<root>-other" doesn't pass as inside.
  return file === root || file.startsWith(root + sep) ? file : null;
}

/**
 * Streams a file if it exists; false when it doesn't (the caller decides what a miss means). A client that goes away, or
 * a read that fails, ends the send: the pipeline closes both ends, so neither the file nor this promise is left open.
 */
export async function sendFile(res: http.ServerResponse, file: string, headers: Readonly<Record<string, string>> = {}): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, { "content-type": mimeOf(file), "content-length": String(info.size), ...headers });
  await pipeline(createReadStream(file), res).catch(() => {});
  return true;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The raw body, of at most `limit` bytes; a larger one is a 413, refused before it is read when it says so up front. */
export async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const tooLarge = new HttpError(413, `the body is over ${limit} bytes`);
  if (Number(req.headers["content-length"] ?? 0) > limit) throw tooLarge;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw tooLarge;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** A JSON body of at most `limit` bytes. A larger one is a 413; one that isn't JSON, a 400. */
export async function readJson(req: http.IncomingMessage, limit = JSON_LIMIT): Promise<unknown> {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "the body must be JSON");
  }
}

export function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(value));
}

export function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(text);
}
