// HTTP plumbing: the local-origin rule, static files, capped JSON bodies, plain replies.
import type http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

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
  ".txt": "text/plain; charset=utf-8",
};

export const mimeOf = (file: string): string => MIME[extname(file).toLowerCase()] ?? "application/octet-stream";

/** JSON bodies are capped at this many bytes. */
export const JSON_LIMIT = 64 * 1024;

/**
 * Only pages served from this machine may change anything: any page the kiosk browser might open could otherwise
 * POST to the Box. A request with no Origin (curl, the deploy's updater, tests) is allowed: browsers always send one
 * on a POST and on a WebSocket upgrade.
 */
export function localOrigin(origin: string | undefined): boolean {
  return origin === undefined || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
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

/** Streams a file if it exists; false when it doesn't (the caller decides what a miss means). */
export async function sendFile(res: http.ServerResponse, file: string, headers: Readonly<Record<string, string>> = {}): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, { "content-type": mimeOf(file), "content-length": String(info.size), ...headers });
  await new Promise<void>((done) => {
    const stream = createReadStream(file);
    stream.on("error", () => {
      res.destroy();
      done();
    });
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A JSON body of at most `limit` bytes. A larger one is a 413; one that isn't JSON, a 400. */
export async function readJson(req: http.IncomingMessage, limit = JSON_LIMIT): Promise<unknown> {
  const tooLarge = new HttpError(413, `the body is over ${limit} bytes`);
  if (Number(req.headers["content-length"] ?? 0) > limit) throw tooLarge;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw tooLarge;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
