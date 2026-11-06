# Games over HTTP

The routes that put a game on the kiosk: a built game's cartridge art and the sandboxed frame its screen runs in, and an
unpacked store bundle. One handler, ahead of the screen's own files; it answers `false` for any path that isn't its own.

| Route | What |
|---|---|
| `GET /games/<id>/icon.svg` | The cartridge art of any installed built game, sealed or not. One that fails the Forge's icon check is replaced by the Box's plain icon. |
| `GET /games/<id>/screen.js` | The game's screen module (`dist/screen.js`), for a playable game only. |
| `GET /games/<id>/frame.html` | The frame page (`page.ts`) under its own CSP, for a playable game only, to this machine only (a local Host). |
| `GET /parts.js`, `/parts.css`, `/parts/<font>`, `/frame.js`, `/bundle-host.js` | The frames' shared assets (`assets.ts`). |
| `GET /store/<hash>/<file>` | A file the unpacked store bundle lists, by exact path, under the bundle's own CSP, to this machine only. `index.html` gets the host script. |

**The frame page** is loaded only into `<iframe sandbox="allow-scripts">`, so its origin is opaque. Its CSP:
`default-src 'none'`; scripts, styles and fonts from the Box's origin only (named outright: `'self'` would name
nothing in an opaque origin); images from the Box or `data:`; inline styles (a game styles itself with a `<style>` it
makes); `connect-src 'none'`; no `<base>`, no forms; `frame-ancestors` the Box; and `sandbox allow-scripts`, so the
page stays sandboxed even if something loads it without the iframe's attribute.

**A store bundle** is served from its temporary folder, by a `BundleLookup` that says where it is and which files it
lists. Its code is untrusted, so it gets none of the Box's own headers, never the launcher token, and its own CSP:
`default-src 'none'`; scripts (inline ones too), styles (the same), fonts, media and images only from its own folder, and
the host script; `data:` images; `connect-src 'none'`; no `<base>`, no forms; `frame-ancestors` the Box; and `sandbox
allow-scripts`. Every file carries it, so an `.html` or `.svg` of a bundle never gets the Box's origin, however it is
opened.

- **By exact path.** A path is looked up in the bundle's list as it stands in the URL, so a name it doesn't list never
  reaches the disk. A bundle's names are lower-case ASCII, so nothing needs decoding.
- **`index.html` is the only page.** A navigation to any other file is a 404, so a game can't land its frame on a second
  page and keep the channel (`screen/frame/`).
- **The host goes first.** `/bundle-host.js` is added straight after any doctype, ahead of everything the game wrote.
  The parser opens the `<head>` for it and skips the page's own, so no comment or odd markup can get in first.

**CORS.** Everything the frame loads is a cross-origin request from `null`: module scripts, fonts and the screen's
`import()` are fetched in CORS mode, so they go out with `Access-Control-Allow-Origin: *`. None of it is secret; the
Box's API stays same-origin. Every answer is `nosniff`; the icon and screen.js carry a CSP that runs nothing, for a
browser that opens them on their own.

**The shared assets** are built from the screen's sources with esbuild on the first request and kept in memory:
`/parts.js` defines `<egb-seg>`, `<egb-plate>`, `<egb-key>` and `<egb-fact>` as it loads, `/parts.css` holds the
tokens and the three faces (fonts under `/parts/`), `/frame.js` is the frame's program (`screen/frame/`), and
`/bundle-host.js` is a bundle's first script, built as a classic script. esbuild's service process is stopped once the
build is done.

| Module | What it is | API |
|---|---|---|
| `routes.ts` | The handler. | `createGameRoutes({ built, bundles?, assets }): GameRoutes`, `BuiltLookup`, `BundleLookup` |
| `page.ts` | The frame page, a bundle's page and their CSPs; the Box's origin from a Host header. | `framePage(title)`, `frameCsp(origin)`, `bundleCsp(origin, hash)`, `withBundleHost(html)`, `BUNDLE_HOST`, `boxOrigin(host)` |
| `assets.ts` | The frames' shared assets, built once. | `createFrameAssets(log): FrameAssets` |

Tests: `routes.test.ts` on a real server over a library with bundled built games: the frame page's CSP, a non-local
Host refused, CORS and types on everything the frame loads, the parts defining themselves, the icon check, and what a
sealed or unknown game gets; and a bundle's CSP, its exact paths, its one page, and no token.

`sandbox.test.ts` proves the walls in a real browser: Chromium with the flags `deploy/pi/units/egb-kiosk.service` starts
it with, read from that file, on the real handler, CSPs, view, gate and channel, with a second server and a UDP socket as
the outside. A game's own files load and its taps and words go through. Then 50-odd tries at getting out (fetch, beacon,
image, form, WebSocket, WebRTC, every kind of link hint, parent access, storage, workers, devices, eval) fail, and the
outside's own count says nothing reached it: no request, no connection, no packet, no name looked up. Of the Box it gets
only its own files and runs no route, though a prerender can still knock on a local port, and a test says so. Forged,
flooding and oversized messages stop at the gate, and each way of leaving loses the page. It is skipped without a
Chromium; `EGB_CHROMIUM` names one.

**It passes only with the unit's two walls.** Without `--host-resolver-rules` and `--webrtc-ip-handling-policy`,
`<link rel="prerender">` reaches the outside, with the CSP and sandbox in place, and a test fails if the unit loses
either. See `screen/frame/README.md`.
