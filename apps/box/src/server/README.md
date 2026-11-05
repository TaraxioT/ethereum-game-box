# The Box server

The Game Box's own server on the Raspberry Pi: it runs the core on Node's ports, owns the receiver's serial port
through the taps library, keeps the ledger and the session log, serves the built screen and the test page, and talks
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
| `EGB_DATA` | `~/.local/share/egb` | The data folder: `ledger.json`, `sessions/YYYY-MM-DD.jsonl`, `badges.json` (`badges.fake.json` for the fake receiver). |
| `EGB_RECEIVER` | `auto` | The receiver's serial port: a path (`/dev/serial/by-id/…`), `auto`, `fake` or `none`. |
| `EGB_STATIONS` | `e4ba70,df3d88` | The station ids at Player 1's and Player 2's seats. |
| `EGB_SCREEN_DIR` | `apps/box/dist/screen` | The built screen (`pnpm --filter @egb/box build:box`). |

Relative paths are from the repo root; `~` is the home folder.

## HTTP

| Route | Who | What |
|---|---|---|
| `GET /api/health` | anyone | `{ ok: true, commit, uptimeMs }`. `commit` is `RELEASE.json`'s at the repo root, else git's `HEAD`, else null. |
| `GET /api/state` | anyone | `{ phase, match, busy, now }`. `busy`: players are past Home, a match is open, or a transaction isn't paid yet. The deploy's updater switches releases only while it is false. |
| `GET /api/box` | anyone | The test page's Box tab: `{ state, power, records }` (the whole `BoxState`, the power switch, each badge's counted wins, losses and draws by address). |
| `POST /api/box/reset` | local origin | Back to Home now: the stakes of a match that hasn't settled go back to their badges. 204. |
| `POST /api/box/power` | local origin | `{ on: boolean }`. Off: the Box misses its settle and the match goes to Refund. 204. |
| `GET /api/taps` | anyone | Everything the Stations and Badges tabs draw: `{ receiver, stations, status, stats, roster, fake }` (`status` and `stats` null with `EGB_RECEIVER=none`; `fake` only with the fake receiver). |
| `POST /api/taps/inject` | local origin | `{ seat: 0 \| 1, badge: "NOVA" \| "0x…" }`: a whole tap by that badge (a roster label, any case, or an address) at that seat, straight into the core, never touching a chip; a roll from `crypto` when the plan is `random`. Not a tap the Box saw: it never makes a result count. Answers `{ tap, plan, badge, accepted }`; an unknown label is 404. |
| `POST /api/taps/buzz` | local origin | `{ seat, kind: "ok" \| "no" }`: the seat's station buzzes once, or twice. |
| `POST /api/taps/press` | local origin | The press round trip: `{ st, rttUs, echoMs, ackMs }`. |
| `POST /api/taps/identify` | local origin | `{ st }`: `get_pkeys` on the badge resting on that station (the roster records it): `{ uid, badge, key1, ms }`. |
| `POST /api/taps/roll` | local origin | `{ st }`: key 2's `sign_random`, verified: `{ uid, badge, roll: { value, counter, payload }, ms }`. |
| `POST /api/taps/bench` | local origin | `{ count? }` (1–1000, default 200): the taps bench's report (`pnpm taps:bench` calls this). |
| `POST /api/taps/fake` | local origin | The fake receiver's hands: `{ op: "place", badge, st }`, `{ op: "lift", badge }`, `{ op: "linkDown" \| "linkUp", st }`, `{ op: "unplug" \| "plug" }`. 409 on real hardware. |
| `GET /api/builder` | launcher token | A stub until the game builder mounts its routes here: 501. |
| `GET /`, `/index.html` | anyone | The screen's page, never cached; the launcher token is written into it only for a top-level navigation. |
| `GET /test` | anyone | The test page (same rules as the screen's page). |
| `GET /…` | anyone | The built files (`assets/` cached for good). |
| `GET /link` (upgrade) | local origin | The screen's WebSocket. |

A station's error (no badge on the reader, a radio timeout, a chip that refused) is a 409 with its message. Every
request that isn't a GET needs a local origin (`http://localhost`, `127.0.0.1` or `[::1]`, any port; no Origin at all
is allowed, as browsers always send one). JSON bodies are capped at 64 KB. Every page and file goes out with the CSP
in `security.ts`. A route marked `launcher` needs the `x-egb-launcher` header to match this boot's token (compared in
constant time).

## Taps

The taps library (`src/taps/`) starts once the server listens, unless `EGB_RECEIVER=none`. It is the core's stations
port (each station's screen and buzz; the views from before it started are sent at once), asks `core.plan(seat)`
after each touch, and hands every `touch`, `done` and `fail` to `core.tap(event, "station")`. Shutting down closes
it, so every open tap ends in `fail`.

## The session log and records

At the end of every match the core writes its transcript (`@egb/sdk`'s `Transcript`: the seed, the badges, each game
tap with its touch time, roll and whether it was taken, the result, and whether it counts) as one line of
`$EGB_DATA/sessions/YYYY-MM-DD.jsonl`, the Box's local date of the match's end. At start the log is read back: each
badge's record (wins, losses, draws) and the counted results of the last hour are rebuilt from it. Only counted
results go into records (the free-result rules, `core/transcript.ts`).

## The link

On connect, a screen gets `{ t: "state", now, state }`; then `{ t: "event", now, state, event }` for every event, in
order and never coalesced. The one change with no event (the stations' views moving with the clock) goes out as a
whole `state` at most every 100 ms; an event cancels a pending one, since it carries the whole state too. The screen
sends `{ t: "command", command }`, checked strictly before it reaches the core. A socket that stops reading (1 MB
unread) or stops answering pings (15 s) is dropped; the screen reconnects and starts from the whole state.

## Modules

| Module | What it is | API |
|---|---|---|
| `main.ts` | The entry: env files, settings, the Box, signals. Uncaught errors are logged and never fatal; SIGTERM and SIGINT stop it within 10 s (the taps closed, the ledger and the log on disk). | |
| `env.ts` | `.env`-style files, never overriding a set key. | `parseEnv`, `loadEnvFile`, `envFiles`, `loadEnv` |
| `settings.ts` | The typed, checked settings. | `readSettings(env, home, repoRoot)`, `SettingsError` |
| `box.ts` | The Box put together: the core on Node's ports, the taps (after it listens), the session log, the routes, the link, one port. | `startBox({ settings, repoRoot, clock?, fake?, log? }): Box` |
| `api.ts` | The Box's routes: health, state, injected taps, the Box tab, the builder stub. | `apiRoutes`, `busy(state)` |
| `taps-api.ts` | The stations' routes for the test page and the bench. | `tapsRoutes` |
| `sessions.ts` | The session log, and the records and per-pair counts rebuilt from it. | `createSessionLog(dataDir, log)` (the core's `MatchLog`), `dayOf` |
| `routes.ts` | The HTTP handler: local origin, the launcher guard, the API, the screen's files. | `createHandler`, `Route` |
| `http.ts` | Static files, capped JSON bodies, the local-origin rule. | `localOrigin`, `within`, `sendFile`, `readJson`, `HttpError` |
| `security.ts` | The CSP and the launcher token. | `CSP`, `createLauncherToken`, `isTopNavigation`, `withToken`, `hasToken` |
| `link.ts` | The screen's WebSocket on the HTTP server (`ws`, `noServer`). | `attachLink(server, box, log)`, `parseCommand` |
| `coalesce.ts` | At most one run per window, always a trailing run. | `coalesce(run, everyMs)` |
| `inject.ts` | Injected taps: a badge by roster label or address. | `parseInjection`, `resolveBadge`, `injectTap` |
| `ledger-file.ts` | The ledger in `$EGB_DATA/ledger.json` (balances, and each stake in escrow under its badge): loaded once, written atomically off the tap path after every change. A file that isn't a ledger is moved aside. | `createLedgerFile(file, log)` |
| `files.ts` | Atomic writes: a temp file, fsync, rename, then the folder fsynced. | `writeFileAtomic` |
| `release.ts` | The running commit. | `readCommit(repoRoot)` |
| `testing.ts` | For tests: a whole Box on a free port with its core (and taps) on a fake clock, a recording screen. | `startTestBox`, `openScreen`, `post`, `flush` |

Tests: `env`, `settings`, `files` (atomic writes and the ledger file), `http` (local origin, CSP, the token, the body
cap, the guard), `link` (state first, events in order, coalescing, commands), `match` (a whole Quick Draw and Stock
Duel over the link with injected taps), `live-link` (the screen's `LiveLink` against a real server), `sessions` (the
log, records rebuilt, per-pair counts) and `fake-box`: the whole Box on `EGB_RECEIVER=fake` with simulated badges
answering real APDUs: join, the stake, a Quick Draw judged at the touch and a Stock Duel on verified rolls to paid
results with their transcripts, Refund by the power switch, a known badge's identify with no chip command, and every
touch ending in done or fail when the receiver is unplugged mid-roll.
