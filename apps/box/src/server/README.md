# The Box server

The Game Box's own server on the Raspberry Pi: it runs the core on Node's ports, serves the built screen, and talks
to the kiosk's screen over a WebSocket. `node apps/box/src/server/main.ts` (or `pnpm --filter @egb/box start`) runs
it: Node runs the TypeScript as it is, so it is written in erasable syntax only, with `.ts` imports, and checked by
`tsconfig.server.json` (Node types, no DOM).

## Settings

Read from the environment, after the env files fill in what isn't set: `EGB_ENV_FILE` (default `~/.config/egb/env`)
first, then the repo's `.env`. A key already set is never overridden. A bad value stops the start with every problem
named.

| Variable | Default | What it is |
|---|---|---|
| `EGB_PORT` | `8790` | The port for HTTP and the link. |
| `EGB_HOST` | `127.0.0.1` | The address it binds. |
| `EGB_DATA` | `~/.local/share/egb` | The data folder: `ledger.json` now; `sessions/` and `badges.json` later. |
| `EGB_RECEIVER` | `auto` | The receiver's serial port: a path (`/dev/serial/by-id/…`), `auto`, `fake` or `none`. |
| `EGB_STATIONS` | `e4ba70,df3d88` | The station ids at Player 1's and Player 2's seats. |
| `EGB_SCREEN_DIR` | `apps/box/dist/screen` | The built screen (`pnpm --filter @egb/box build:box`). |

Relative paths are from the repo root; `~` is the home folder.

## HTTP

| Route | Who | What |
|---|---|---|
| `GET /api/health` | anyone | `{ ok: true, commit, uptimeMs }`. `commit` is `RELEASE.json`'s at the repo root, else git's `HEAD`, else null. |
| `GET /api/state` | anyone | `{ phase, match, busy, now }`. `busy`: players are past Home, a match is open, or a transaction isn't paid yet. The deploy's updater switches releases only while it is false. |
| `POST /api/taps/inject` | local origin | `{ seat: 0 \| 1, badge: { address, name } }`: a whole tap by that badge at that seat, straight into the core (a roll from `crypto` when the plan is `random`). Answers `{ tap, plan, accepted }`. |
| `GET /api/builder` | launcher token | A stub until the game builder mounts its routes here: 501. |
| `GET /`, `/index.html` | anyone | The screen's page, never cached; the launcher token is written into it only for a top-level navigation. |
| `GET /…` | anyone | The built screen's files (`assets/` cached for good). |
| `GET /link` (upgrade) | local origin | The screen's WebSocket. |

Every request that isn't a GET needs a local origin (`http://localhost`, `127.0.0.1` or `[::1]`, any port; no Origin
at all is allowed, as browsers always send one). JSON bodies are capped at 64 KB. Every page and file goes out with
the CSP in `security.ts`. A route marked `launcher` needs the `x-egb-launcher` header to match this boot's token
(compared in constant time).

## The link

On connect, a screen gets `{ t: "state", now, state }`; then `{ t: "event", now, state, event }` for every event, in
order and never coalesced. The one change with no event (the stations' views moving with the clock) goes out as a
whole `state` at most every 100 ms; an event cancels a pending one, since it carries the whole state too. The screen
sends `{ t: "command", command }`, checked strictly before it reaches the core. A socket that stops reading (1 MB
unread) or stops answering pings (15 s) is dropped; the screen reconnects and starts from the whole state.

## Modules

| Module | What it is | API |
|---|---|---|
| `main.ts` | The entry: env files, settings, the Box, signals. Uncaught errors are logged and never fatal; SIGTERM and SIGINT stop it within 10 s. | |
| `env.ts` | `.env`-style files, never overriding a set key. | `parseEnv`, `loadEnvFile`, `envFiles`, `loadEnv` |
| `settings.ts` | The typed, checked settings. | `readSettings(env, home, repoRoot)`, `SettingsError` |
| `box.ts` | The Box put together: the core on Node's ports, the routes, the link, one port. It listens before anything slow. | `startBox({ settings, repoRoot, clock?, log? }): Box` |
| `api.ts` | The API routes. | `apiRoutes`, `busy(state)` |
| `routes.ts` | The HTTP handler: local origin, the launcher guard, the API, the screen's files. | `createHandler`, `Route` |
| `http.ts` | Static files, capped JSON bodies, the local-origin rule. | `localOrigin`, `within`, `sendFile`, `readJson`, `HttpError` |
| `security.ts` | The CSP and the launcher token. | `CSP`, `createLauncherToken`, `isTopNavigation`, `withToken`, `hasToken` |
| `link.ts` | The screen's WebSocket on the HTTP server (`ws`, `noServer`). | `attachLink(server, box, log)`, `parseCommand` |
| `coalesce.ts` | At most one run per window, always a trailing run. | `coalesce(run, everyMs)` |
| `inject.ts` | Injected taps. | `parseInjection`, `injectTap` |
| `ledger-file.ts` | The ledger in `$EGB_DATA/ledger.json`: loaded once, written atomically off the tap path after every change. A file that isn't a ledger is moved aside. | `createLedgerFile(file, log)` |
| `files.ts` | Atomic writes: a temp file, fsync, rename, then the folder fsynced. | `writeFileAtomic` |
| `release.ts` | The running commit. | `readCommit(repoRoot)` |
| `testing.ts` | For tests: a whole Box on a free port with its core on a fake clock, a recording screen. | `startTestBox`, `openScreen`, `post` |

Not yet here: the stations port is a no-op until the taps library plugs in, and the match log a no-op until the
session log.

Tests: `env`, `settings`, `files` (atomic writes and the ledger file), `http` (local origin, CSP, the token, the body
cap, the guard), `link` (state first, events in order, coalescing, commands), `match` (a whole Quick Draw and Stock
Duel over the link with injected taps) and `live-link` (the screen's `LiveLink` against a real server).
