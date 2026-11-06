// A built game's frame page (/games/<id>/frame.html), a store bundle's page (/store/<hash>/index.html) and the
// Content-Security-Policy of each.
//
// A frame page is loaded only into <iframe sandbox="allow-scripts">, so its origin is opaque and 'self' would name
// nothing it loads: the policy names the Box's origin outright (from the request's Host, which must be a local
// one). Scripts, styles and fonts come only from the Box; images from the Box or data: URLs; inline styles are
// allowed (a game's screen styles itself with a <style> it makes, and the parts set style attributes); it may connect
// nowhere, frame nothing, post no form, and be framed only by the Box. `sandbox allow-scripts` keeps the page
// sandboxed even if something ever loads it without the iframe's attribute.
//
// A bundle's index.html is a game's own page, so its policy also allows inline scripts, and the only files it reaches
// are its own folder and the host script. Nothing else on the Box's origin, not even an image from the API.

/** The script that gives a bundle's page `window.egb` (assets.ts). */
export const BUNDLE_HOST = "/bundle-host.js";

/** The Box's origin from a request's Host header, or null when it isn't this machine. */
export function boxOrigin(host: string | undefined): string | null {
  return host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host) ? `http://${host}` : null;
}

export function frameCsp(origin: string): string {
  return [
    "default-src 'none'",
    `script-src ${origin}`,
    `style-src ${origin} 'unsafe-inline'`,
    `font-src ${origin}`,
    `img-src ${origin} data:`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors 'self' ${origin}`,
    "sandbox allow-scripts",
  ].join("; ");
}

export function bundleCsp(origin: string, hash: string): string {
  const own = `${origin}/store/${hash}/`;
  return [
    "default-src 'none'",
    `script-src ${own} ${origin}${BUNDLE_HOST} 'unsafe-inline'`,
    `style-src ${own} 'unsafe-inline'`,
    `font-src ${own}`,
    `img-src ${own} data:`,
    `media-src ${own}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors 'self' ${origin}`,
    "sandbox allow-scripts",
  ].join("; ");
}

/**
 * A doctype with whatever may stand ahead of it and leave the page in standards mode: white space and comments. A comment
 * that the parser would end sooner than its `-->` (`<!-->`, `<!--->`, a `--!>`) doesn't match, so what follows it, which
 * the parser would read as markup, can't pass for part of the comment.
 */
const DOCTYPE = /^﻿?(?:\s|<!--(?!-?>)(?:(?!--!?>)[\s\S])*?-->)*<!doctype[^>]*>/i;
/** How far into a page a doctype is looked for: past any honest comment, and the search can't cost the server's one thread much. */
const DOCTYPE_WITHIN = 64 * 1024;

/**
 * A bundle's page with the host as its first script. It goes straight after any doctype, ahead of everything the game
 * wrote but the comments before that doctype: the parser opens the <head> for it and skips the page's own, and no odd
 * markup can get in first. Without a doctype it goes at the very start.
 */
export function withBundleHost(html: string): string {
  const doctype = DOCTYPE.exec(html.slice(0, DOCTYPE_WITHIN))?.[0] ?? "";
  return `${doctype}<script src="${BUNDLE_HOST}"></script>${html.slice(doctype.length)}`;
}

/** The page: the parts' look and the parts, then the frame's program, which loads the game's screen.js beside it. */
export function framePage(title: string): string {
  const safe = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safe}</title>
<link rel="stylesheet" href="/parts.css">
<script type="module" src="/parts.js"></script>
<script type="module" src="/frame.js"></script>
</head>
<body><main id="game"></main></body>
</html>
`;
}
