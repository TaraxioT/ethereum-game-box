# Built games' frames

A built game's screen runs in the kiosk inside `<iframe sandbox="allow-scripts">`: no same-origin access, its page
under a CSP with `connect-src 'none'` (`server/games/`). It only draws. The kiosk tells it the state and what happened
through a typed `postMessage` channel (`@egb/sdk`'s `ToFrame`); it answers only `ready` and `error` (`FromFrame`).

**The kiosk's side.** `frameView(builtMatch)` is the router's view for a built match (`views/routes.ts`); in dev,
Vite passes `/games`, `/parts…` and `/frame.js` through to the Box server.

`frameView(source)` is the `ViewFactory`: the iframe fills the stage below
the Box's overlay (130 px landscape, 150 px portrait). When the frame says `ready` it gets `init` with the state as it
is then; after that, an `update` for each moment (the match ending, an accepted tap, a new rules state) and nothing for
the Box's own business. A frame that errors, or isn't ready within 8 s, gets a quiet `SCREEN FAULT · PLAY ON` plate:
the rules run on the server and the stations show the game, so the match goes on.

**The channel.** Out: `postMessage(message, "*")`, since no origin can name an opaque frame. In: only from that
frame's window, only from the opaque origin `null`, only `{ t: "ready" }` or `{ t: "error", message }` (cut to 300
characters).

**The frame's side** (`/frame.js`, built by the server): loads the game's `screen.js` beside the page, posts `ready`,
mounts the `GameScreen` on `init` (again on a second `init`), hands it each `update`, and reports errors from mount,
update, the window and unhandled rejections, at most 10. It takes messages only from its parent at the Box's origin
and posts only to it.

| Module | What it is | API |
|---|---|---|
| `view.ts` | The kiosk's view of a built match. | `frameView(source): ViewFactory`, `READY_TIMEOUT_MS` |
| `feed.ts` | What the frame is told, from BoxState and BoxEvents. Pure. | `builtMatch` (the router's source: the built play and its game.json from the library), `FrameMatch`, `FrameSource`, `frameSeats`, `frameInit`, `frameEvent`, `frameUpdate` |
| `channel.ts` | The kiosk's end of the channel and the iframe's attributes. | `openFrameChannel(host, frame, onMessage)`, `parseFromFrame`, `frameAttributes(id, title)` |
| `runtime.ts` | The frame's end, platform-free. | `createFrameRuntime({ root, post, load })`, `MAX_ERRORS` |
| `frame.ts` | `/frame.js`: the runtime wired to the frame page. | entry |
| `parts.ts` | `/parts.js`: defines the parts a built screen may use by tag. | entry |
| `parts.css` | `/parts.css`: the tokens, the three faces, the frame's one element. | entry |
| `frame.css` | The view's iframe and fault plate. | |

Tests: `frame.test.ts` (the sandbox attribute, the channel dropping anything but ready and error and anything from
another window or a non-opaque origin, the runtime's mount, updates and capped errors, the feed's events).
