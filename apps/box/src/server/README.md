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
| `EGB_FORGE_PROVIDER` | `claude` | Who builds games: `claude` (the Pi's Claude login) or `sim` (a recorded build replayed, shown SIMULATED). Anything else stops the start. |

The game builder reads its own settings from the same environment (`src/builder/README.md`): `EGB_MODEL` (`off`:
keywords read every answer), `ANTHROPIC_API_KEY`, `FORGE_MODEL`, `FORGE_TIMEOUT_MS`, `EGB_VOICE` (`mock` or
`elevenlabs`), `ELEVENLABS_API_KEY`, `EGB_VOICE_ID`, `EGB_VOICE_TTS_MAX_CHARS`, `EGB_VOICE_STT_MAX_MIN`.

Relative paths are from the repo root; `~` is the home folder.

## HTTP

| Route | Who | What |
|---|---|---|
| `GET /api/health` | anyone | `{ ok: true, commit, uptimeMs }`. `commit` is `RELEASE.json`'s at the repo root, else git's `HEAD`, else null. |
| `GET /api/state` | anyone | `{ phase, match, busy, now }`. `busy`: players are past Home (seated, or in the game builder), a match is open, a transaction isn't paid yet, or a game is queued or being built. The deploy's updater switches releases only while it is false. |
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
| `/api/builder/…` | launcher token | The game builder: below. |
| `GET /`, `/index.html` | anyone | The screen's page, never cached; the launcher token is written into it only for a top-level navigation. |
| `GET /test` | anyone | The test page (same rules as the screen's page). |
| `GET /…` | anyone | The built files (`assets/` cached for good). |
| `GET /link` (upgrade) | local origin | The screen's WebSocket. |

A station's error (no badge on the reader, a radio timeout, a chip that refused) is a 409 with its message. Every
request that isn't a GET needs a local origin (`http://localhost`, `127.0.0.1` or `[::1]`, any port; no Origin at all
is allowed, as browsers always send one). JSON bodies are capped at 64 KB. Every page and file goes out with the CSP
in `security.ts`. A route marked `launcher` needs the `x-egb-launcher` header to match this boot's token (compared in
constant time).

## The game builder

The Forge and the Designer (`src/builder/`) start once the server listens (the Forge reads its jobs from the disk),
sharing one edit lock, and their routes join the handler then (`builder-host.ts`). A confirmed design is built at once
on `EGB_FORGE_PROVIDER`; a provider that can't build here (no Claude login) refuses the confirm with a 409. Builds run
in the Forge's child processes, so nothing here waits on one. The Forge's `onLibraryChange` is the hook the library's
rescan mounts on (it logs until then).

Every route is a `launcher` route; every one that isn't a GET also needs a local origin. Paths and replies are in
`builder-wire.ts`, which the screen and the test page import too.

| Route | What |
|---|---|
| `GET /api/builder` | `BuilderStatus`: the provider (and `simulated`), whether it can build, who reads answers, the voice, `building`. |
| `GET /api/builder/designer` | The open design (`DesignerState`), or null. |
| `POST /api/builder/designer/start` | A new design, replacing any other. |
| `POST /api/builder/designer/choose` | `{ choice, session? }`: one of the step's keys; on the read-back, `build` builds. |
| `POST /api/builder/designer/answer` | `{ text, session? }`: typed words, read by the model (≤ 5 s) or keywords. |
| `POST /api/builder/designer/back` | `{ session? }`: reopens the step settled before this one. |
| `POST /api/builder/designer/confirm` | `{ session? }`: builds the brief: `{ brief, job }`. |
| `POST /api/builder/voice/transcribe` | The recorded answer's bytes (its mime type as content-type, at most 2 MB; `?session=`): `{ text, state }`. Mock voice hears the scripted player's line. |
| `POST /api/builder/voice/speak` | `{ session? }`: the question spoken, `{ text, clip }` (clip null: caption only). |
| `GET /api/builder/voice/clip` | `?file=`: a clip the voice made (audio/mpeg); any other name is 404. |
| `GET /api/builder/voice/turns` | Mock voice's scripted turns for the rest of the design (`{ say, hear }[]`). |
| `GET /api/builder/forge/jobs` | Every job kept, newest first. |
| `GET /api/builder/forge/job` | `?id=`: `{ job, events }`. |
| `POST /api/builder/forge/cancel` | `{ id }`: `{ cancelled }` (false once it is installing or over). |
| `POST /api/builder/forge/remove` | `{ game }`: deletes an installed built game (never a team game). 204. |
| `GET /api/builder/events` | Server-Sent Events: `hello` (`{ designer, job, status }`), then the replayed job's events as `forge`, then every `designer` change and every `forge` event live. The replay is the queued or running job's, or `?job=`'s. A comment every 15 s keeps it open; a client 1 MB behind is dropped. |

A Designer refusal is its own status (`no-session` 404, `stale` 409, `locked` 409, `bad-choice` 400, `empty` 400,
`not-ready` 409) with its code in the `x-egb-designer-code` header and its sentence as the body; a Forge refusal is a
409; a malformed body, a 400.

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
sends `{ t: "command", command }`, checked strictly before it reaches the core (`build` opens the game builder from
Home). A socket that stops reading (1 MB
unread) or stops answering pings (15 s) is dropped; the screen reconnects and starts from the whole state.

## Modules

| Module | What it is | API |
|---|---|---|
| `main.ts` | The entry: env files, settings, the Box, signals. Uncaught errors are logged and never fatal; SIGTERM and SIGINT stop it within 10 s (the taps closed, the ledger and the log on disk). | |
| `env.ts` | `.env`-style files, never overriding a set key. | `parseEnv`, `loadEnvFile`, `envFiles`, `loadEnv` |
| `settings.ts` | The typed, checked settings. | `readSettings(env, home, repoRoot)`, `SettingsError` |
| `box.ts` | The Box put together: the core on Node's ports, the taps and the game builder (after it listens), the session log, the routes, the link, one port. | `startBox({ settings, repoRoot, clock?, fake?, log?, builder? }): Box` |
| `api.ts` | The Box's routes: health, state, injected taps, the Box tab. | `apiRoutes`, `busy(state, building)` |
| `builder-host.ts` | The game builder on the server: the Forge and the Designer on one lock, a confirmed design built on `EGB_FORGE_PROVIDER`, every change fanned out to the stream. | `startBuilder(options): Builder`, `forgeProvider(env)` |
| `builder-api.ts` | The builder's routes, refusals as their codes. | `builderRoutes(builder)`, `AUDIO_LIMIT` |
| `builder-stream.ts` | Server-Sent Events: named events, a client's first events in the tick it joins, pings, slow clients dropped. | `createBuilderStream()` |
| `builder-wire.ts` | The builder's paths, bodies, replies and events; the launcher token's header and meta names. No Node, no DOM. | `BUILDER`, types |
| `builder-testing.ts` | For tests: a Box whose shelf is the Forge's fixture, token-carrying requests, the event stream parsed. | `startBuilderBox`, `call`, `callJson`, `openStream` |
| `taps-api.ts` | The stations' routes for the test page and the bench. | `tapsRoutes` |
| `sessions.ts` | The session log, and the records and per-pair counts rebuilt from it. | `createSessionLog(dataDir, log)` (the core's `MatchLog`), `dayOf` |
| `routes.ts` | The HTTP handler: local origin, the launcher guard, the API, the screen's files. | `createHandler`, `Route` |
| `http.ts` | Static files, capped bodies, the local-origin rule. | `localOrigin`, `within`, `sendFile`, `readBody`, `readJson`, `HttpError` |
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
touch ending in done or fail when the receiver is unplugged mid-roll. `builder-api`: the launcher token on every
builder route, a local origin on every write, the Designer's refusals as their codes, the audio cap, mock voice heard,
a confirm that builds (the design locked, `/api/state` busy) with the event stream replaying the build to a late screen
and `?job=` replaying a finished one. `builder-session`: a whole design by mock voice over the HTTP API, its spoken "yes"
building a game with the sim provider, installed, every step on the stream.
