// A built game's frame page (/games/<id>/frame.html) and its own Content-Security-Policy.
//
// The page is loaded only into <iframe sandbox="allow-scripts">, so its origin is opaque and 'self' would name
// nothing it loads: the policy names the Box's origin outright (from the request's Host, which must be a local
// one). Scripts, styles and fonts come only from the Box; images from the Box or data: URLs; inline styles are
// allowed (a game's screen styles itself with a <style> it makes, and the parts set style attributes); it may connect
// nowhere, frame nothing, post no form, and be framed only by the Box. `sandbox allow-scripts` keeps the page
// sandboxed even if something ever loads it without the iframe's attribute.

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
