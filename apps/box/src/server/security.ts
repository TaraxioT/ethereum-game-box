// The screen's Content-Security-Policy and the launcher token.
//
// The launcher token: the builder's routes start paid model sessions and install code, and a built game's screen will
// run on this machine too, so "a local origin" isn't enough for them. Each boot makes a random token that only the
// kiosk's own page gets: it is written into index.html as <meta name="egb-launcher"> only for a top-level navigation
// (Sec-Fetch-Dest: document, Sec-Fetch-Mode: navigate: headers page script can't set), never for a script's fetch of
// the page. The screen sends it back as the `x-egb-launcher` header, compared in constant time.
import type http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Scripts, styles, fonts, sockets and frames from this server only; no plugins, no <base>, and no page may frame the
 * Box. Two allowances, both for the screen as built: `data:` images (the page's icon) and inline style attributes
 * (two parts draw SVG with a `style` attribute); neither can load anything from elsewhere.
 */
export const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const LAUNCHER_HEADER = "x-egb-launcher";
export const LAUNCHER_META = "egb-launcher";

export function createLauncherToken(): string {
  return randomBytes(24).toString("base64url");
}

/** A top-level navigation: the only request whose answer may carry the token. */
export function isTopNavigation(req: http.IncomingMessage): boolean {
  return req.headers["sec-fetch-dest"] === "document" && req.headers["sec-fetch-mode"] === "navigate";
}

/** The page with the token's meta tag at the top of its head. */
export function withToken(html: string, token: string): string {
  const tag = `<meta name="${LAUNCHER_META}" content="${token}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${tag}`) : `${tag}${html}`;
}

/** The request carries this boot's token. */
export function hasToken(req: http.IncomingMessage, token: string): boolean {
  const got = req.headers[LAUNCHER_HEADER];
  if (typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
