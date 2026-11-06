# Games' frames

Built games and store bundles both run in the kiosk inside `<iframe sandbox="allow-scripts">`, on one channel. A built
game only draws; a bundle's page holds the game, and has [a few more words](#store-bundles).

A built game's screen runs with no same-origin access, its page under a CSP with `connect-src 'none'`
(`server/games/`). It only draws. The kiosk tells it the state and what happened through a typed `postMessage` channel
(`@egb/sdk`'s `ToFrame`); it answers only `ready` and `error` (`FromFrame`).

**The kiosk's side.** `frameView(builtMatch)` is the router's view for a built match (`views/routes.ts`); in dev,
Vite passes `/games`, `/parts…` and `/frame.js` through to the Box server.

`frameView(source)` is the `ViewFactory`: the iframe fills the stage below
the Box's overlay (130 px landscape, 150 px portrait). When the frame says `ready` it gets `init` with the state as it
is then; after that, an `update` for each moment (the match ending, an accepted tap, a new rules state) and nothing for
the Box's own business. A frame that errors, or isn't ready within 8 s, gets a quiet `SCREEN FAULT · PLAY ON` panel:
the rules run on the server and the stations show the game, so the match goes on.

**The channel.** Out: `postMessage(message, "*")`, since no origin can name an opaque frame. In: only from that
frame's window, only from the opaque origin `null`, only `{ t: "ready" }` or `{ t: "error", message }` (cut to
`MAX_MESSAGE`, 300 characters, from `@egb/sdk`). Only while the frame shows its own page: `allow-scripts` lets a
frame navigate itself, and the page it lands on (the kiosk's `frame-src 'self'` keeps it on the Box's own) is out
from under the frame's CSP. The iframe's first `load` is its page; a second closes the channel for good (nothing
more goes out or comes in), and the view removes the frame and shows the fault panel.

**The frame's side** (`/frame.js`, built by the server): loads the game's `screen.js` beside the page, posts `ready`,
mounts the `GameScreen` on `init` (again on a second `init`), hands it each `update`, and reports errors from mount,
update, the window and unhandled rejections, at most 10. It takes messages only from its parent at the Box's origin
and posts only to it.

## Store bundles

A bundle's `index.html` comes from the store: its code is untrusted and runs only here, never in Node. The Box serves it
at `/store/<hash>/index.html` under its own CSP (`server/games/`), with `/bundle-host.js` added as its first script.

**What a game gets**, as `window.egb` (`BundleApi` in `@egb/sdk`):

| Member | What it does |
|---|---|
| `players` | `[{ name }, …]` in seat order, there from the page's first line. |
| `onTap(fn)` | `fn({ seat, at, roll })` for each tap: `at` is the Box's clock, `roll` null unless the manifest asks for `random` taps. |
| `event(name, data)` | For the log, labelled as the game's claim. A name is 1 to 40 printable characters; data is at most 1024 bytes of JSON. |
| `station(seat, text)` | A line for a seat's station, cut to 40 printable characters. |
| `buzz(seat)` | The seat's station buzzes. |
| `end()` | The game is over. That closes the match and nothing else: a game has no say over money. |

**How it starts.** A page's first script runs before any message could reach it, and games read `players` on their
first line. So the iframe's `name` carries the players as JSON, and the host reads them from there. The kiosk speaks
first: on the frame's first `load`, when the game's scripts have run and its listeners are on, it sends `bundle-init` with
the players' latest names, which go in the same array. The host answers `ready`, and the taps begin.

**The gate** (`bundle-gate.ts`). The host is a convenience, not a wall: a game can post anything by hand. So everything
is decided on the kiosk's side, before a message goes further:

- A message is weighed before anything else: at most 4096 characters and parts of plain JSON (`FRAME_LIMITS.messageWeight`,
  four times an event's data). The walk stops at that weight, however large the message. One past it, or holding what JSON
  can't say (a buffer, a `Date`, a `Map`), is dropped, and the third such message loses the page: the kiosk's timers, screen
  and link to the Box share one thread. The browser's own clone is the one cost the gate can't stop, as it comes before
  the gate: millions of small parts held the thread about 5 s a message on a Mac, which is why so few of them lose the page.
- A message must be exactly a `FromBundle`. A page has no word for a tap, a badge, the network or money, so nothing it
  posts can become one. The seat must be the match's.
- `FRAME_LIMITS` holds the rates: 20 events a second (40 at once), 4 station lines and 2 buzzes a second a seat. Whatever
  is over a rate is dropped, not queued.
- Game events get half of `LOG_LIMITS` (2500 entries, 512 KB), so a flood can't crowd out the Box's own taps.
- One `ready`, at most 10 errors, and nothing at all after `end`.

**The second-load rule stays:** a frame that navigates loses its channel for good. A page that leaves before its own
`load` gets past the count, since the landing page's `load` is then the first, and a page that calls `window.stop()` has no
`load` at all. So `ready` only counts as an answer: one a page says before the kiosk asks is spent. A page that stops its
load or reloads for ever is never asked, and a landing page has nothing to answer with: the Box shows no other page of a
bundle in a frame (a navigation to one is a 404), the kiosk's `frame-src 'self'` keeps out `data:` and `blob:` pages, and
the Box's other pages have nothing of the game's in them. Either way the view's timeout loses the page. A page it can't
tell from the real one would be `index.html` again, which is the game.

**Lost pages.** The view (`bundleFrameView`) passes what the gate lets through to the Box through its `powers`. A page
that never says ready, leaves, or keeps sending what the gate can't weigh is lost: the frame goes, and
`powers.end("lost")` closes the match at once. A stray error only puts up the quiet plate: the taps still count.

**What the CSP can't do.** Under `default-src 'none'` and the sandbox, Chromium still lets a page reach the network four
ways: `<link rel="prerender">` sends a full GET to any URL, `preconnect` opens a connection, `dns-prefetch` looks a name
up, and WebRTC sends UDP (`webrtc 'block'` isn't enforced). The host can't take those away, because a nested `srcdoc`
frame gets a fresh window. Only the kiosk's own start can stop them: `deploy/pi/units/egb-kiosk.service` starts Chromium
with `--host-resolver-rules` and `--webrtc-ip-handling-policy`, and `server/games/sandbox.test.ts` runs that line's flags.

| Module | What it is | API |
|---|---|---|
| `view.ts` | The kiosk's view of a built match, and the glass every frame view stands on. | `frameView(source): ViewFactory`, `frameGlass(layout, attributes)`, `READY_TIMEOUT_MS` |
| `feed.ts` | What the frame is told, from BoxState and BoxEvents. Pure. | `builtMatch` (the router's source: the built play and its game.json from the library), `FrameMatch`, `FrameSource`, `frameSeats`, `frameInit`, `frameEvent`, `frameUpdate` |
| `channel.ts` | The kiosk's end of the channel and the iframes' attributes. | `openFrameChannel(host, frame, read, { message, loaded?, left })`, `parseFromFrame`, `frameAttributes(id, title)`, `bundleFrameAttributes(hash, title, players)` |
| `runtime.ts` | The frame's end, platform-free. | `createFrameRuntime({ root, post, load })`, `errorText`, `MAX_ERRORS` |
| `frame.ts` | `/frame.js`: the runtime wired to the frame page. | entry |
| `bundle-view.ts` | The kiosk's view of a store match. | `bundleFrameView(source, powers): ViewFactory`, `BundleMatch`, `BundleSource`, `BundlePowers`, `BundleEnd` |
| `bundle-gate.ts` | What a bundle's page may say, and how much. | `parseFromBundle(data, seats)`, `createBundleGate(seats, now, flooded)` |
| `bundle-runtime.ts` | `window.egb`, platform-free. | `createBundleRuntime({ post, name })` |
| `bundle-host.ts` | `/bundle-host.js`: the runtime wired to a bundle's page. A classic script, so it runs first. | entry |
| `sandbox-kiosk.ts` | The kiosk's end of `server/games/sandbox.test.ts`. Nothing in the screen imports it. | entry |
| `parts.ts` | `/parts.js`: defines the parts a built screen may use by tag (`<egb-key>`, `<egb-fact>`, `<egb-seg>`, and `<egb-plate>`, a panel lit unless `metal`), in the Grid look; games written before the Grid keep working. | entry |
| `parts.css` | `/parts.css`: the Grid tokens, the faces, the frame's one element. | entry |
| `frame.css` | The view's iframe and fault panel. | |

Tests: `frame.test.ts` (the sandbox attribute, the channel dropping anything but ready and error and anything from
another window or a non-opaque origin, closing for good on the frame's second load, the runtime's mount, updates and capped errors, the feed's events).
`bundle.test.ts` (what a page may say and how much, `window.egb`, the view of a store match). A real browser proves the
walls: `server/games/sandbox.test.ts`.
