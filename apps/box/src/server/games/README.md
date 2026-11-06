# Built games over HTTP

The routes that put a built game on the kiosk: its cartridge art, and the sandboxed frame its screen runs in. One
handler, ahead of the screen's own files; it answers `false` for any path that isn't its own.

| Route | What |
|---|---|
| `GET /games/<id>/icon.svg` | The cartridge art of any installed built game, sealed or not. One that fails the Forge's icon check is replaced by the Box's plain icon. |
| `GET /games/<id>/screen.js` | The game's screen module (`dist/screen.js`), for a playable game only. |
| `GET /games/<id>/frame.html` | The frame page (`page.ts`) under its own CSP, for a playable game only, to this machine only (a local Host). |
| `GET /games/icon.svg` | The Box's plain icon, on every store game's cartridge. |
| `GET /parts.js`, `/parts.css`, `/parts/<font>`, `/frame.js` | The frame's shared assets (`assets.ts`). |

**The frame page** is loaded only into `<iframe sandbox="allow-scripts">`, so its origin is opaque. Its CSP:
`default-src 'none'`; scripts, styles and fonts from the Box's origin only (named outright: `'self'` would name
nothing in an opaque origin); images from the Box or `data:`; inline styles (a game styles itself with a `<style>` it
makes); `connect-src 'none'`; no `<base>`, no forms; `frame-ancestors` the Box; and `sandbox allow-scripts`, so the
page stays sandboxed even if something loads it without the iframe's attribute.

**CORS.** Everything the frame loads is a cross-origin request from `null`: module scripts, fonts and the screen's
`import()` are fetched in CORS mode, so they go out with `Access-Control-Allow-Origin: *`. None of it is secret; the
Box's API stays same-origin. Every answer is `nosniff`; the icon and screen.js carry a CSP that runs nothing, for a
browser that opens them on their own.

**The shared assets** are built from the screen's sources with esbuild on the first request and kept in memory:
`/parts.js` defines `<egb-seg>`, `<egb-plate>`, `<egb-key>` and `<egb-fact>` as it loads, `/parts.css` holds the
tokens and the three faces (fonts under `/parts/`), `/frame.js` is the frame's program (`screen/frame/`). esbuild's
service process is stopped once the build is done.

| Module | What it is | API |
|---|---|---|
| `routes.ts` | The handler. | `createGameRoutes({ built, assets }): GameRoutes`, `BuiltLookup`, `FALLBACK_ICON` |
| `page.ts` | The frame page and its CSP; the Box's origin from a Host header. | `framePage(title)`, `frameCsp(origin)`, `boxOrigin(host)` |
| `assets.ts` | The frame's shared assets, built once. | `createFrameAssets(log): FrameAssets` |

Tests: `routes.test.ts` on a real server over a library with bundled built games: the frame page's CSP, a non-local
Host refused, CORS and types on everything the frame loads, the parts defining themselves, the icon check, and what a
sealed or unknown game gets.
