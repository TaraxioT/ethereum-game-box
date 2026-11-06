// The HTTP handler: the API routes, then the built screen. Every request must be addressed to this machine by name
// (a loopback Host); every one that isn't a GET also needs this server's own origin; every one to the API must come from
// no other site's page; the routes marked `launcher` also need this boot's launcher token.
import type http from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, loopbackHost, ownRequest, sameOrigin, sendFile, sendText, within } from "./http.ts";
import { CSP, hasToken, isTopNavigation, withToken } from "./security.ts";

export interface Route {
  readonly method: "GET" | "POST" | "DELETE";
  /** An exact path under /api/. */
  readonly path: string;
  /** The builder's routes: only the kiosk's own page, with the launcher token, may call them. */
  readonly launcher?: boolean;
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): unknown;
}

export interface HandlerOptions {
  readonly routes: readonly Route[];
  /** Built games' cartridges and frames (server/games/), ahead of the screen's files: true when it answered. */
  readonly games?: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean>;
  /** The built screen. */
  readonly screenDir: string;
  readonly token: string;
  readonly log: (text: string) => void;
}

const STATIC_HEADERS = { "content-security-policy": CSP, "x-content-type-options": "nosniff" } as const;

export function createHandler(options: HandlerOptions): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { routes, screenDir, token } = options;

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<void> {
    if (!ownRequest(req.headers["sec-fetch-site"])) return sendText(res, 403, "only the Box's own pages may do that");
    const route = routes.find((r) => r.path === url.pathname && (r.method === method || (method === "HEAD" && r.method === "GET")));
    if (!route) {
      const known = routes.some((r) => r.path === url.pathname);
      return sendText(res, known ? 405 : 404, known ? "method not allowed" : "no such route");
    }
    if (route.launcher && !hasToken(req, token)) return sendText(res, 403, "only the Box's own screen may do that");
    await route.handle(req, res, url);
  }

  /**
   * A page of the Box's own (the screen, the test page): the launcher token goes in only for a top-level navigation,
   * and the page is never cached.
   */
  async function page(req: http.IncomingMessage, res: http.ServerResponse, file: string): Promise<void> {
    let html: string;
    try {
      html = await readFile(join(screenDir, file), "utf8");
    } catch {
      return sendText(res, 503, "The screen isn't built: run pnpm --filter @egb/box build:box");
    }
    const body = isTopNavigation(req) ? withToken(html, token) : html;
    res.writeHead(200, { ...STATIC_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  }

  async function screen(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
    if (path === "/" || path === "/index.html") return page(req, res, "index.html");
    if (path === "/test" || path === "/test/") return page(req, res, "test/index.html");
    const file = within(screenDir, path);
    if (!file) return sendText(res, 404, "not found");
    // Vite names everything under assets/ by its content: it never changes under the same name.
    const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    if (await sendFile(res, file, { ...STATIC_HEADERS, "cache-control": cache })) return;
    sendText(res, 404, "not found");
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://box");
    const method = req.method ?? "GET";
    const read = method === "GET" || method === "HEAD";
    if (!loopbackHost(req.headers.host)) return sendText(res, 421, "the Box answers only to this machine's own names");
    if (!read && !sameOrigin(req.headers.origin, req.headers.host)) return sendText(res, 403, "only the Box's own pages may do that");
    if (url.pathname.startsWith("/api/")) return api(req, res, url, method);
    if (options.games && (await options.games(req, res, url))) return;
    if (!read) return sendText(res, 405, "method not allowed");
    return screen(req, res, url.pathname);
  }

  return (req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (error instanceof HttpError) {
        // A body that was cut off short is left unread: close the connection rather than read the rest of it.
        if (error.status === 413) res.setHeader("connection", "close");
        return sendText(res, error.status, error.message);
      }
      options.log(`http ${req.method ?? "GET"} ${req.url ?? ""}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      sendText(res, 500, "the Box hit an error");
    });
  };
}
