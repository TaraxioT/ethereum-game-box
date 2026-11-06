# The Box server, the tap stations and the game builder

The plan for the Game Box's own server on the Raspberry Pi, the tap stations that feed it, and the game builder that
makes new games on the Box. No blockchain yet: money, blocks and transactions stay simulated behind the interface the
chain plugs into later. Plan live at https://plans.georgekm.com/ethereum-game-box-box-server-2026-11-06/.

## 1. Goal

- The games work on the real Box: badges tap real tap stations, the Box server on the Pi runs the match, and the
  screen from the UI pass draws it.
- A player can build a new game on the Box with the game builder, then play it.
- **Every game runs on the Pi:** its rules in the Box server, and its screen in the Pi's kiosk browser. The demo
  build is the only exception: it runs in any visitor's browser.

Priorities, in order:

1. **Hardware performance**, above all the link between the ESP boards and the Pi.
2. Generated games run.
3. Code quality at least as high as the UI pass.

**No blockchain yet.** No contracts, RPC, relayer, Box signer or ENS. Money, blocks and transactions stay simulated,
behind the interface the chain plugs into later. Only what has to wait for the chain is simulated; everything else
(stations, badges, randomness, the server, the builder) is real.

## 2. What exists today

**In this repo** (the UI pass, branch `game-ui`):

- `@egb/box` with the screen (`apps/box/src/screen/`): Vite and TypeScript, custom-element parts, a router of views
  (attract, Home, Join, Stake, Result, Refund) and two game screens (Quick Draw, Stock Duel).
- The screen talks only to `BoxLink` (`state()`, `subscribe()`, `send()`), with `BoxState`, `BoxEvent`,
  `ScreenCommand` and `StationView` in `screen/link/types.ts`.
- `SimLink` (`screen/link/sim/engine.ts`) is the whole Box in the browser: the phase machine
  (boot → attract → home → join → stake → playing → result | refund), a pure ledger with a faucet and escrow, a block
  clock at Sepolia's pace, simulated transactions (`SIGNED → SENT → IN BLOCK n → PAID`, no hash, shown `SIMULATED`),
  the station OLED text, and a bot on Player 2. It reads `Date.now()` and timers directly.
- Pure, tested rules for Quick Draw and Stock Duel (`games/*/rules.ts`), `GameRules<S, E>`, `Seat`, seeded
  randomness (`hash32`, `mulberry32`, `shuffle`).
- Demo mode draws the missing hardware on a desk: pucks with 128×64 OLEDs, draggable badges, the `DEMO` plate. It is
  live at https://ethereum-game-box.pages.dev/.
- The server, taps, firmware, deploy and builder folders hold only READMEs. No `@egb/sdk`, no `@egb/shared` code.

**What this pass builds on**, as plain facts about the hardware and the way the Box must behave:

- **The boards.** Each tap station is a 01Space ESP32-S3 0.42″ board: SSD1306 72×40 OLED on SDA 41 / SCL 40, WS2812
  LED on GPIO39, BOOT on GPIO0, a vibration motor on GPIO16, and a PN532 in I²C mode on the second bus (`Wire1`,
  SDA 35 / SCL 36, 400 kHz, address 0x24, firmware 1.6, optional IRQ on 37). The receiver is an ESP32-C3 on the Pi's
  USB (LED A GPIO12, BOOT GPIO9); its flash only reads back correctly at 40 MHz in DIO mode.
- **The radio.** ESP-NOW on channel 1, no power save, unicast at 24 Mbps. A press round trip C3 ↔ S3 has a median
  of 2.4–2.8 ms; pings between station and receiver a median of 3.1 ms, 96–98 % under 6 ms. USB serial writes must
  never wait (`setTxTimeoutMs(0)`): an unread port otherwise stalls a loop for up to 100 ms a write.
- **The reader.** A chip read takes 27.4–29.4 ms; listing the chips ~35 ms; each APDU ~9 ms of station I²C plus
  3–15 ms of radio. Reading 16 bytes of each PN532 answer and NACKing for the rest saves ~6 ms an exchange. A read
  leaves the chip halted, so a resting chip needs a presence check: every 20 ms, the PN532's Diagnose first, then an
  ISO-DEP R(NAK) (Diagnose alone fails on HaLos); non-ISO-DEP chips get a 5 ms RF-field cycle. A fresh HaLo answers
  neither until something talks to it, so it gets 800 ms of grace; and there are no checks for 150 ms after a Pi
  request. A PN532 cut off mid-transfer can hold SCL low after the S3 resets; only a power cycle frees it.
- **The chip.** HaLo key 2 signs `sign_random` (a counter plus 28 random bytes) in 700–900 ms; selecting the HaLo
  applet costs 40–75 ms; an applet ID the chip doesn't answer (status `6D00`) wastes ~50 ms. Identity is the UID,
  tied to the keys by a roster after the first `get_pkeys`. Six rules govern chip use (key 1 only for money, UID for
  identity, roll only when the outcome is decided, time from the touch, tell the player how long to hold, always read
  an unknown chip); this pass uses all but the first, and never touches key 1.
- **The station's own feedback.** The LED, OLED and buzz follow what the Pi asks of the chip (blue blinking `HOLD`,
  fast `HOLD STILL` while signing, green `DONE`, red `AGAIN` / `TOO SOON`), with the Pi able to reword each. Screens
  are `key=value` lines (`tag`, `big`, `small`, `hold`, `sign`, `done`, `fail`, `ttl`), dropped by the station when
  their `ttl` runs out or 3 s after the link drops. The Pi resends on change, on relink, and every 5 s with
  `ttl=15`. A link times out after 2.5 s of silence (any packet counts, compared signed).
- **The receiver's serial lines.** One JSON object per line at 115200 (`ready`, `tap`, `gone`, `nfc`, `ping`, `link`,
  `buzz` / `buzz_ok` / `buzz_fail`, `nfc_res` / `nfc_fail`, `screen_ok` / `screen_fail`, `signed`, presses); commands
  in (`press`, `buzz`, `nfc <st> <id> …`, `screen <st|all> <hex>`). A known bug: the first command after the receiver
  starts produces no event.
- **Bridge timings that work:** a request waits 4.0 s, a re-select 3.0 s, a dropped link 2.0 s of grace, and a sign
  result is reported 0.4 s after the chip answers.
- **Games.** Quick Draw judges by touch time, waits 450 ms after the first touch for the other station, reads for up
  to 1.5 s, calls a player too slow after 4 s, and takes a seated badge's tap as a rematch only 4 s after the result,
  so a chip left on the reader can't skip it; it never says GO on the speaker (the speaker lags). Stock Duel freezes a seat's front card on `touch`, plays it at the touch time on `done`, and
  releases it on `fail`.
- **The builder.** A one-question-at-a-time Designer produces a brief; a Forge copies a template into a confined
  folder and runs a Claude agent on it with five file tools and one `build_game` tool, then bundles, checks and
  installs the game. Agent file access is checked by one confinement function from both `canUseTool` and a
  `PreToolUse` hook. Free results count only when the Box saw both badges tap, 12 s passed, and the pair has had
  fewer than 12 results that hour.
- **Deploying to the Pi.** Build a release, smoke-test it, wait for an idle Box, switch a symlink atomically, roll
  back on failure, prune old releases.

## 3. Architecture

```
  badge ─NFC─▶ tap station (ESP32-S3) ─ESP-NOW─▶ receiver (ESP32-C3) ─USB serial─▶ ┌──────────── Box server (Node, Pi) ────────────┐
  badge ─NFC─▶ tap station (ESP32-S3) ─ESP-NOW─▶          ▲                           │ taps/: receiver port, stations, libhalo,      │
                                                          └───── commands ◀──────────│        roster, the tap state machine          │
                                                                                      │ core/: the phase machine (ledger, chain clock,│
                                                                                      │        txs, station views, bot), behind ports │
                                                                                      │ server/: HTTP, WebSocket link, data, records  │
                                                                                      │ builder/: Designer; Forge in a child process  │
                                                                                      └──────┬──────────────────────┬─────────────────┘
                                                                                             │ stdio (JSON lines)   │ WebSocket (state, event)
                                                                                             ▼                      ▼
                                                                   built game's rules: one child process     kiosk screen (Chromium):
                                                                   per game, Node --permission (reads only   LiveLink → the UI pass's views;
                                                                   its own bundle; no fs writes, net,        built game's screen in
                                                                   workers, children or addons)              <iframe sandbox="allow-scripts">
                                                                                                             fed by a typed postMessage channel
```

- **One process owns the serial port**: the Box server. No helper process, bridge or monitor sits between the
  receiver and the server.
- **The core** (`apps/box/src/core/`) has no DOM and no Node APIs. It reaches the world through ports: clock and
  timers, stations, badges (tap events in), chain (simulated today), and a rules runner (built games).
- **Two hosts run the core:** `SimLink` in the browser for the demo build, and the Box server on the Pi.
- **Built games** are refereed by the server: their rules run in a sandboxed child, their screens in a sandboxed
  frame that only draws.

```
apps/box/src/
  core/        phase machine, ledger, chain clock, txs, station views, bot, catalogue; ports.ts; no DOM, no Node
  server/      main.ts, env, data dir, http (CSP, local origin, launcher token), ws link, ledger store,
               sessions/records, rules runner host, test page API; tsconfig with Node types, no DOM
  taps/        receiver (Node's own tty handle), protocol parser, stations + screens, libhalo over nfc, roster,
               tap machine, fake receiver, simulated badges, bench
  builder/     designer/, forge/ (child process), voice/
  games/       quick-draw/, stock-duel/ in the module shape (game.json, rules.ts, screen.ts, icon.svg, BLUEPRINT.md)
  screen/      the UI pass's screen; link/live.ts (LiveLink), link/sim.ts (SimLink); the Build and Designer views
  test-page/   /test: Stations, Badges, Box, Builder
packages/sdk/  @egb/sdk: GameRules, Seat, randomness, transcripts, the rules-runner and frame protocols, manifest
firmware/tap-station/  protocol.md, lib/ (EgbLink), station/, receiver/, test/ (host tests), scripts
deploy/pi/     setup.sh, release.sh, activate.sh, update.sh, push.sh, lib.sh, units/, env.example
```

## 4. The Box core

**Lift the phase machine out of the browser.** `screen/link/sim/engine.ts` becomes `apps/box/src/core/`:

- It holds the phase machine with its ledger, chain clock, transactions, station views and bot.
- It has no DOM and no Node APIs, and reads no global clock. It reaches the world through ports:

```ts
interface CorePorts {
  clock: Clock;                 // now(), after(ms, fn), every(ms, fn), cancel(handle)
  stations: StationsPort;       // show(seat, view), buzz(seat, kind: "ok" | "no")
  chain: ChainPort;             // the simulated chain today: blocks, gas, transactions
  ledger: LedgerStore;          // load() / save(ledger): in memory in the browser, $EGB_DATA/ledger.json on the Pi
  rules: RulesRunnerPort;       // built games' rules (the server's child processes); absent in the demo
  log: MatchLog;                // transcripts; a no-op in the demo
}
// in: core.tap(event: TapEvent), core.send(command: ScreenCommand); out: BoxLink's state() and subscribe()
```

- **Two hosts run it.** `SimLink`, in the browser, for the demo build: the user sees no change, and the live demo
  keeps working. The Box server, on the Pi.
- **The ledger.** The server keeps the simulated ledger in `$EGB_DATA/ledger.json`, written atomically (write a temp
  file, fsync, rename). Transactions still have no hash and show `SIMULATED`.
- **`StationView`** becomes what a real station can show: `tag` (≤ 3 characters), `big` (≤ 10) and `small` (≤ 20),
  with the optional overrides `hold` / `sign` / `done` / `fail`. The drawn puck draws the same model.
- **Taps carry their phase.** The core takes `touch`, then `done` or `fail`, for each tap. A game that judges by time
  uses the touch time; a game that needs the chip's number waits for `done`.
- **`LiveLink`** implements `BoxLink` over a WebSocket (`ws` on the server, the browser's own on the screen):
  - The whole state goes out on connect, then `(state, event)` messages.
  - Events are never coalesced. State changes with no event (the Rolodex turning) coalesce at 100 ms.
  - Every message carries the server's `now`, and the screen draws with the link's clock offset (the screen's
    `Date.now()` is never trusted against the server's times).
  - It reconnects with backoff (250 ms doubling to 4 s), and a reconnect gets the whole state again.
  - `VITE_EGB_MODE=box` uses `LiveLink`; `demo` uses `SimLink`.
- **The server:**
  - Binds `127.0.0.1:8790`, and binds before the library scan, so the kiosk never waits on a slow disk.
  - Serves the built screen, the test page and built games.
  - Requires a local origin for every non-GET request and for the WebSocket upgrade.
  - Injects a per-boot launcher token into the screen's HTML for top-level navigations only
    (`Sec-Fetch-Dest: document`). The builder routes require it, compared with `timingSafeEqual`.
  - Sends a strict CSP: `default-src 'self'`, `connect-src 'self'`, `frame-src 'self'`, `object-src 'none'`,
    `base-uri 'none'`, `frame-ancestors 'none'`; built games' frames get their own CSP with `connect-src 'none'`.
  - Caps JSON bodies at 64 KB. Contains uncaught errors (logged, never fatal) and caps shutdown at 10 s.
  - Its env loader never overrides a key that is already set.
- **Node runs the TypeScript directly** (`node apps/box/src/server/main.ts`). Erasable syntax only
  (`erasableSyntaxOnly`), and the server has its own tsconfig with Node types and no DOM.

## 5. Taps and badges

**No middlemen.** The server owns the receiver's tty (read through Node's own tty handle, no native addon) and speaks
`firmware/tap-station/protocol.md`. HaLo commands go through libhalo's `execHaloCmd` (`@arx-research/libhalo/api/custom`), over `nfc <st> <id> …` lines.
There is no C helper, no Python bridge and no monitor process.

**The tap state machine.** For each `tap` line from the receiver:

1. `touch` goes out at once, with the touch time.
2. The tap's plan runs: `identify` | `random` | `none`.
3. Then `done`, or `fail` with a reason (`lifted`, `radio`, `not-halo`, `refused`, `verify`, `link`).

**Every `touch` ends in `done` or `fail`**, even when the receiver drops: a closed port fails every open tap at once.

**Identity is the UID**, kept in a roster at `$EGB_DATA/badges.json`:

- An unknown chip is read with `get_pkeys`, whatever the plan, so a stranger's chip can never pass as a seated player.
- After that, `identify` reads nothing.
- After an `identify` or `none` tap, the server selects the applet, so the station's presence check doesn't see the
  chip flicker. Errors there are dropped: the tap is already done.
- Until ENS, a badge's name is a local label (`NOVA`), shown without `.gamebox.eth`.

**Randomness** comes from key 2's `sign_random`, verified on the Pi against the roster's identity, and only on taps
whose number the game uses. **Key 1 is never used in this pass.**

**Time comes from the touch**, estimated from the receiver's `at_us` and the station's `read_us`, mapped onto the
Pi's clock by a running minimum of (Pi receive time − `at_us`). It is never the time the reply arrived.

**Stations:**

- Seats map to station ids from `EGB_STATIONS` (default `e4ba70,df3d88`: Player 1, Player 2).
- Screens go out on change, on relink, and every 5 s with `ttl=15`.
- A station buzzes on an accepted tap (one short), and gives a "no" buzz (two short) on a refused one.
- A dropped link gets 2 s of grace before an open tap on it fails.

**Fakes.** A fake receiver speaks the exact serial lines (the protocol's example lines are its test vectors), and
simulated badges with real secp256k1 keys answer real APDUs, including signed `sign_random`. `EGB_RECEIVER=fake`
uses both, so the whole Box runs on a laptop.

**Injected taps.** The server can inject taps for a named badge at a seat, straight into the core. This tests games
on the Pi while the real stations show the screens and buzz.

**The test page** (`/test`) has four tabs:

- **Stations:** link, RSSI, ping, reader, chip on the reader, Buzz, screen text, press round trip, and the live
  benchmark.
- **Badges:** identify, roll, the roster, and injected taps.
- **Box:** state, phase, reset, and the power switch that makes the Box miss its settle, for Refund.
- **Builder:** jobs, events, and removing a built game.

## 6. Games on the Box

Every game's rules run on the Pi, in the server, and the server referees every game.

**Team games** run in the core, in-process.

- **Quick Draw** judges by touch time. After the first touch it waits `SETTLE_MS` (450 ms) for the other station's
  touch, reads for up to `READ_WAIT_MS` (1500 ms), calls `TOO_SLOW_MS` (4000 ms) after the draw, and takes a seated
  badge's tap as a rematch only `REMATCH_TAP_MS` (4000 ms) after the result, so a resting chip can't skip it. It never
  says GO on the speaker. Its taps are `identify`.
- **Stock Duel.** Its taps are `random`. `touch` freezes that seat's Rolodex front card; `done` plays it at the touch
  time with the chip's roll; `fail` releases it. New rule events (`touch`, `done`, `fail`) with tests.

**Built games run their rules in a child process per game**, started with Node's permission model:

- `node --permission --allow-fs-read=<its bundle>` and nothing else: no writes, child processes, workers, addons,
  WASI, inspector or network.
- It talks over stdio in JSON lines (`start`, `step`, `state`, `error`).
- It starts at Join, so the first step pays no start-up cost.
- A step over its time budget (50 ms to start with) or a crash voids the match and refunds both stakes.
- A test proves every refusal on the Node version the Pi runs. A refusal that version can't enforce is closed another
  way before generated rules run on the Pi.

**Built games' screens run in the kiosk**, inside `<iframe sandbox="allow-scripts">`:

- No same-origin access, and CSP `connect-src 'none'`.
- Their assets are served with `Access-Control-Allow-Origin: *` (the frame's origin is opaque).
- The frame only draws. It gets the state and events through a typed `postMessage` channel and sends back only
  readiness and errors.

**One module shape for every game:**

```
games/<id>/
  game.json     manifest: id, title, players, minutes, stakes, taps (identify | random), template, budgetMs
  rules.ts      pure GameRules plus stations(state): [StationView, StationView]
  screen.ts     draws from state + events (a team game: a ViewFactory; a built game: the frame's draw module)
  icon.svg      the cartridge art
  BLUEPRINT.md  how it plays, its constants, its station text
```

The bundler (esbuild) makes `rules.js` for Node and `screen.js` for the browser.

**The shared contract moves to `packages/sdk` (`@egb/sdk`):** `GameRules`, `Seat`, seeded randomness, transcripts,
the rules-runner protocol and the frame channel, and the manifest type. Built games use the screen's parts by tag
(`<egb-key>`, `<egb-plate>` …) from a parts bundle the server serves.

**Transcripts.** Every match writes one line to `$EGB_DATA/sessions/YYYY-MM-DD.jsonl`: the seed, each tap with its
touch time and roll, and the result. Records rebuild from the log.

**Free results** count only for taps the Box saw: both seated badges tapped, at least 12 s passed, and at most 12
results per pair per hour.

## 7. The game builder

It runs on the Pi, with the Pi's Claude login.

- **Entry.** A blank `NEW GAME` cartridge at the end of Home's rack opens the Designer (box build only).
- **The Designer** asks one question at a time:
  - The steps are template, mechanic, theme, twist, stakes, voice, title, confirm. Settled steps are skipped.
  - Choices are brass keys.
  - Typed or spoken answers are read by `claude-haiku-5-5`, with a 5 s timeout and a keyword fallback.
  - Edits are locked while a build runs.
  - A late model reply applies to the brief as it is by then, never to the brief it was asked about.
  - The result is a `GameBrief`.
- **The Forge** runs one build at a time, in a child process, so a build never stalls the tap path:
  1. It copies the template into `$EGB_DATA/forge/work/<id>/`, with a read-only `.reference/` folder.
  2. It runs the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, lazy-imported): tools Read, Write, Edit, Glob
     and Grep; one MCP tool, `build_game`, deliberately not in `allowedTools`; `settingSources: []`;
     `permissionMode: "default"`; `canUseTool` and a `PreToolUse` hook, both calling one confinement check; a minimal
     child environment; `claude-sonnet-5-5`, 40 turns, 8 minutes.
  3. `build_game` runs the manifest check, a typecheck and esbuild in parallel, then the icon check.
  4. The bundle is written outside the folder.
  5. A failed build gets one resumed fix-up turn. A bad icon falls back to a plain one.
  6. It installs by renaming the game into `$EGB_DATA/games/<id>/`, and the cartridge slides into the rack. A game
     whose bundle fails shows sealed.
- **Confinement:** symlinks are resolved; reads only inside the folder, outside `dist/` and `node_modules/`; no
  writes to `.reference`, `dist`, `node_modules` or `.claude`; no `..`, `~` or outside paths in globs; unknown tools
  are denied.
- **The bundler guard** allows imports only from the game and `@egb/sdk`. It refuses import attributes and odd file
  extensions.
- **The build on screen.** Events stream to the screen: `status`, `say`, `tool`, `tool_done`, `compile`, `result`.
  The screen shows the World Computer at work: packets on the traces, the agent's words on an LCD, and compile
  plates, in the parts and look of `plan/game-ui.md`.
- **Providers:** `claude` is live. `sim` replays a recorded run; it is labelled SIMULATED and is never a fallback.
- **Built games are refereed.** Their text claims no proof.
- **The shelf** of templates is discovered from `forge.template` in each game's manifest. It ships Quick Draw (the
  default) and Stock Duel.
- **Voice is a port.** It defaults to `mock`; `elevenlabs` needs `ELEVENLABS_API_KEY`. The Designer works fully by
  touch.
- Bet on X and B17 stay sealed.

## 8. Firmware

`firmware/tap-station/`, Arduino, esp32 core 3.3.x.

**The boards.** The station is the 01Space ESP32-S3 0.42″ board: SSD1306 72×40 OLED on SDA 41 / SCL 40; WS2812 LED
on GPIO39, BOOT on GPIO0, motor on GPIO16; PN532 in I²C mode on `Wire1`, SDA 35 / SCL 36, at 400 kHz, with an optional
IRQ on 37. The receiver is an ESP32-C3: LED A on GPIO12, BOOT on GPIO9.

**Keep every documented behaviour:**

- **Radio:** ESP-NOW on channel 1, `WIFI_PS_NONE`, unicast at 24 Mbps; `Serial.setTxTimeoutMs(0)`.
- **Press and resend:** the press is an interrupt that wakes a high-priority task; the LED switches in the receive
  callback, before the ack; resends every 20 ms, 25 tries, each id counted once; the link times out after 2.5 s of
  silence (any packet counts), compared signed.
- **Presence checks:** every 20 ms, Diagnose first, then R(NAK); cycle the RF field for chips that aren't ISO-DEP;
  800 ms of grace for a fresh chip; 150 ms of quiet after a Pi request. **Measured and changed:** Diagnose fails on
  these badges (status 0x13) and leaves a chip nothing has talked to deaf to R(NAK), so every check fell back to a
  ~68 ms field-cycle re-read. The station selects the applet right after the tap and then checks with R(NAK) alone
  (4.3 ms), so the grace is gone too; a chip that misses R(NAK) is re-read with a field cycle from then on, and a
  `gone` cycles the field so a chip still on the reader comes back as a fresh tap.
- **The reader:** read 16 bytes of each answer, then NACK for the rest; clock the bus clear; send the sign reply
  before the LED and the log.
- **Interfaces:** the LED / OLED / buzz table; the screen payload keys; the serial protocol.

**Fix what was left:**

- **Structure.** Station modules: link, NFC driver, presence, screen model, OLED render, LED, motor, CLI; no file over
  ~300 lines. One library (`EgbLink`) shared by both sketches: packets, reliable send, station table, hex, line
  reader, JSON writer, constants.
- **Wire format.** Small tagged packets per type, not one 67-byte union; only `tap`, `gone` and `signed` carry the
  chip. One generic resend slot for packets, NFC requests and screens. No HaLo parsing in the link: the Pi sends
  signing APDUs as a `sign` op.
- **Timing.** NFC waits use IRQ plus a task notification when pin 37 is wired, otherwise a yielding wait; no busy
  spin, under 1 ms added to a read. The station loop is event-driven, and the OLED draws in its own low-priority task.
- **Memory.** No heap on hot paths: no `String`, no `Serial.printf` of 64 or more characters, `esp_read_mac` only,
  one static JSON writer. State shared across tasks is owned by one task, or atomic.
- **Smaller fixes.** Press state per station; `buzz_fail` carries `st` and `id`; a failed ESP-NOW start shows on the
  OLED; a `stats` command reports stack high-water marks; the first-command bug is found and fixed.

**Host tests** with the host C++ compiler (`pnpm firmware:test`): packets; the screen parser and font fit; the JSON
writer and hex; resend timing on a fake clock.

**`pnpm firmware:build`** compiles both sketches with `--warnings all`: S3 `esp32:esp32:esp32s3:CDCOnBoot=cdc`; C3
`esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashFreq=40,FlashMode=dio` (at 80 MHz its flash reads garbage). Each `.ino`
stays a one-line stub. On Apple Silicon it adds `--build-property tools.ctags.path=/opt/homebrew/bin`.

**`pnpm firmware:flash`** copies the merged bins to the Pi and flashes them there with `esptool`, by `by-id` path,
with nothing holding the ports.

**`protocol.md` is the one spec.** The TypeScript tests use its example lines verbatim.

## 9. Performance

ESP ↔ Pi speed is the first requirement.

**The budget per hop** (target for a known chip's `identify` tap):

| # | Hop | Budget |
|:-:|---|---|
| 1 | chip lands → station sends `tap` | ≤ 30 ms (the read); the UID before the wake-up step if that measures faster |
| 2 | radio, station → receiver | ≤ 2 ms median |
| 3 | receiver → USB line | ≤ 0.5 ms |
| 4 | Pi read and parse | ≤ 0.1 ms an event |
| 5 | core | ≤ 1 ms |
| 6 | command back (Pi → receiver → station) | ≤ 3 ms median |
| 7 | station acts (buzz, LED, OLED row) | ≤ 1 ms to start |
| 8 | screen paint | one frame + 10 ms after the event reaches the Pi |

**Station speed-ups**, each measured and kept only if it wins:

- The station selects the HaLo applet itself as soon as it detects an ISO-DEP chip, and puts the answer in the `tap`.
  This saves a round trip. **Kept in another form:** the station selects right after sending the `tap` and answers
  the Pi's identical SELECT from its kept answer (3.4 ms). Measured: no select, tap at 28.9 ms and the applet ready
  at the Pi at 56.8 ms; the answer in the tap, both at 52.0 ms; select after the tap, tap at 28.9 ms and applet at
  51.8 ms.
- It tries the applet ID that chip answered last first. This saves a `6D00` miss. **Kept:** these badges answer only
  the legacy ID; the other costs a `6D00` after 23.4 ms, so the station's select is 20 ms instead of 43.
- It reports the UID before the wake-up step. **Dropped:** the UID arrives at 22.2 ms instead of 29.0, but the PN532
  then won't carry the chip's ISO-DEP framing (RATS by hand costs 9.2 ms), so chip commands would get slower.

**Pi side:**

- Read the serial port with no line-buffering delay and few allocations (one byte scanner, no stream parser chain).
- Taps are handled before anything else.
- Builds and built-game rules never run on the main event loop.
- The server unit runs at a higher priority (`Nice=-5`).
- Keep JSON lines unless the Pi bench shows parsing costs more than 0.1 ms an event; then switch to compact binary
  framing.

**The bench.** `pnpm taps:bench` on the Pi runs at least 200 of each and reports median, p95 and max: pings; press
round trips both ways; `buzz` → `buzz_ok`; `screen` → `screen_ok`; `nfc list`; Pi serial write → reply; event-loop
delay, idle and during a game build. Run once with the Bluetooth speaker playing, its volume untouched.

**Targets:** match or beat every number in §2; the event loop stays under 5 ms at p99 during a build; a tap shows on
the kiosk within one frame plus 10 ms of reaching the Pi.

**Measured results** (on the Pi, through the Box server, 200 of each, badges resting on both readers):

| What | Median | p95 | p99 | Max | Target |
|---|--:|--:|--:|--:|---|
| Pi serial write → reply (`press` → `c3_press`) | 2.17 ms | 2.97 | 4.93 | 5.36 | |
| Press C3 → S3, receiver round trip | 2.81 ms | 4.90 | 6.33 | 6.38 | 2.4–2.8 ms |
| Press C3 → S3, Pi write → ack | 4.05 ms | 6.20 | 7.97 | 8.13 | |
| Press S3 → C3 (firmware bench) | 2.53 / 2.44 ms | | | | 2.8 ms |
| Ping, P1 / P2 | 2.81 / 2.87 ms | 4.90 / 4.52 | 6.19 / 7.09 | 6.22 / 7.34 | 3.1 ms, 96–98 % < 6 ms |
| `buzz` → `buzz_ok`, P1 / P2 | 2.85 / 2.84 ms | 4.54 / 4.91 | 7.52 / 5.42 | 9.91 / 6.24 | |
| `screen` → `screen_ok`, P1 / P2 | 2.87 / 2.85 ms | 5.07 / 4.87 | 5.99 / 5.55 | 41.5 / 6.66 | |
| `nfc list`, Pi round trip | 69.0 ms | 71.0 | 73.9 | 84.8 | ~35 ms (an empty reader) |
| Chip read on the station (`read_us`) | 28.9 ms | | | | 27.4–29.4 ms |
| Applet select on the station | 20.2 ms | | | | 40–75 ms |
| Identify, an unknown badge (`get_pkeys` + select), Pi | 130–167 ms | | | | ~150–250 ms |
| Verified `sign_random` roll, Pi | 372–384 ms | | | | 700–900 ms |
| Parse a line | 1.8 µs | 2.2 | 2.4 | 2.4 | ≤ 0.1 ms: JSON lines stay |
| Event-loop delay, idle | 1.05 ms | 1.07 | 1.12 | 1.84 | p99 < 5 ms |
| Event-loop delay, during a live `claude` build | 1.05 ms | 1.07 | 1.26 | 1.88 | p99 < 5 ms |
| Kiosk frame time, Home / Quick Draw / Stock Duel, through blocks | 16.7 ms | 16.7 | | 16.8 | 60 fps |

- `nfc list` with a badge resting on the reader is a field cycle (21 ms, of which the PN532 spends 6.3 ms switching
  the field off) plus listing up to two chips (42.6 ms against 29.1 ms for one); the ~35 ms target was an empty
  reader, which couldn't be measured with the badges in place.
- The run with the Bluetooth speaker playing couldn't be made: no speaker was connected (the Pi's only sink was a
  dummy output), and the Pi's audio is not to be changed.
- The serialport addon's reader stopped after its first chunk on the Pi (Node 26, Linux arm64): replies came a write
  late, 108 ms median and up to 897 ms. Reading the tty through Node's own handle fixed it (2.2 ms).

## 10. Real and simulated

| Piece | This pass | Later |
|---|---|---|
| Tap stations, receiver, radio | Real | |
| Badge identity (UID + roster, `get_pkeys`) | Real | ENS names |
| Randomness (`sign_random`, verified) | Real | |
| Stake signatures (key 1) | Not used: a stake is accepted on a tap | Permit2 entry signed by key 1 |
| Ledger (balances, faucet, escrow) | Simulated, persisted in `$EGB_DATA/ledger.json` | The token on Sepolia |
| Blocks and gas | Simulated clock at Sepolia's pace | Sepolia reads |
| Transactions | Simulated, no hash, shown `SIMULATED` | Relayer and the Box key |
| Rules and refereeing | Real, on the Pi | Results signed by the Box key |
| Game builder (Claude) | Real, on the Pi | |
| Voice | Mock by default; ElevenLabs behind a key | |
| Demo build | Fully simulated in the browser (`SimLink`) | |

## 11. Constraints

- One process owns the serial port.
- The kiosk screen holds 60 fps on the Pi while the server runs.
- Vitest for every test.
- `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm firmware:test` pass, and `pnpm firmware:build` compiles
  clean.
- Every module is documented in its README, and the root README layout is updated.
- Keys only in `.env` and the Pi's env file; never committed, printed or logged.
- Never change the Pi's speaker, volume or audio sink.

## 12. Steps

One or more commits each, in this order. If time runs out, cut from the end.

1. **Lift the core.** Every UI test still passes, and the demo is unchanged.
2. **Server and link.** Env, data folder, HTTP, WebSocket, `LiveLink`, checks, CSP, `main.ts`.
3. **Protocol and taps.** `protocol.md`, the receiver module, stations, screens, buzz, the fakes, injected taps,
   libhalo over `nfc`, the roster, the tap state machine, and the Stations and Badges tabs.
4. **Games on the server.** Quick Draw and Stock Duel on real taps, transcripts, the session log, records, the
   ledger.
5. **Firmware.** The library, station, receiver, host tests, a clean compile, and the flash script.
6. **SDK, library, rules runner and frames.** Both games reshaped into the module shape, with a `BLUEPRINT.md` each.
7. **The Forge.**
8. **The Designer**, plus the Build screen and the new cartridge.
9. **Voice.**
10. **Pi deploy** (`deploy/pi/`): `setup.sh` (Node, `uhubctl`, the `dialout` group, a udev rule naming the receiver
    by USB id); an updater that builds, smoke-tests, waits for an idle Box, switches the symlink, rolls back on
    failure and follows `EGB_DEPLOY_BRANCH` (default `main`); a push-to-Pi path that rsyncs a branch through the same
    release and activate steps; systemd units for the server (`Nice=-5`), the kiosk and the updater timer;
    `env.example`.
11. **Pi bring-up.** Flash, deploy, bench, and run games on the hardware.

## 13. On the Pi

Brought up on 2026-11-06 on the Pi 5 at the table, with a HaLo badge resting on each station's reader throughout.
The results of the bench are in §9.

**What changed on the Pi**

- The previous Box's user units (`esp-monitor`, `gamebox-server`, `gamebox-ui`, `gamebox-deploy.timer`) were checked
  idle, recorded in `~/egb-takeover/units-before.txt`, then stopped and disabled. Nothing was deleted.
  `~/egb-takeover/README.txt` says how to turn them back on.
- Each board's flash was saved before the first flash, in `~/egb-takeover/flash-backup/` (4 MB each, with
  `SHA256SUMS`).
- `deploy/pi/setup.sh` installed Node 26.13 in `~/.local/lib/nodejs` (the system's Node 22 is untouched), pnpm
  12.3.4, `uhubctl`, the `/dev/egb-receiver` udev rule, the nice limit the server needs, and the units.
  `egb-server` and `egb-kiosk` start at boot; `egb-update.timer` stays disabled until the repo has the deploy key.
- The audio, speaker and volume were not touched.

**Tested on the hardware**

- All three boards run the new firmware. Every flash hung a station's PN532, and switching every USB port's power off and on
  freed it each time: `for h in 1 3 2 4; do uhubctl -l $h -a off; done; sleep 3; for h in 1 3 2 4; do uhubctl -l $h -a on; done`.
- The first-command bug: a freshly enumerated USB tty echoes the receiver's buffered output back to it until the host
  switches it to raw mode, gluing the host's first command onto a fragment of the receiver's own line. The receiver
  now takes the command out of the echoed junk; a command sent the moment the port opens is answered.
- The serialport addon's reader stalled on the Pi (replies a write late, 108 ms median, up to 897 ms); the server now
  reads the tty through Node's own handle (2.2 ms).
- Badges: identify of an unknown badge (`get_pkeys`) 130–167 ms; a verified `sign_random` roll 372–384 ms, the
  chip's counter advancing by one each time.
- Buzz, screens and the receiver's press work on both stations (the bench's `buzz_ok`, `screen_ok`, `c3_ack` on every
  try); a station's own press was measured by the firmware bench (2.53 / 2.44 ms), since nobody was there to press
  BOOT.
- Station OLEDs follow the game, read with `frame.py` at each phase: `SIGN 10 EGB`, `WAIT tap on DRAW`,
  `WIN 45 ms` / `LOSE 191 ms`, the Stock Duel ticker on the front card, `DIAL`, the round's stat, `OFFLINE wait 3
  blocks`, `REFUNDED +10 EGB`. A badge left resting kept `DONE` on the screen for good; the station now shows a result
  for 1.5 s, then the Box's screen.
- Quick Draw and Stock Duel played end to end on the Pi with injected taps while the real stations showed the screens
  and buzzed: join, stake, play, result and payout (Quick Draw judged at the touch: 45 ms against 191 ms; Stock Duel
  over two rounds on `price` and `24h move`, both picked from the two badges' rolls), and a refund after cutting the
  power from the test page (both stakes back).
- A game built on the Pi: through the Designer by typed answers (read by `claude-haiku-5-5` on the Pi's Claude
  login), the Forge built **Rooftop Dash** with `claude-sonnet-5-5` in 57 s (12 turns, $0.19): manifest, typecheck,
  bundle with a test match, icon, then installed. Its cartridge took its place in the rack, and it played a whole
  match on the Pi with its rules in the sandboxed child and its screen in the sandboxed frame, the stations showing its
  own text (`HOLD red light, don't tap`, `WIN 5 of 5 taps`), and paid out. The event loop stayed at a p99 of 1.26 ms
  through the build.
- The kiosk: the Pi's panel runs at 60.04 Hz. Each simulated block cost a 133–150 ms frame (GPU re-raster as parts
  moved on and off their own layers); with those parts on layers of their own it holds 16.7 ms frames through blocks
  on Home and in both games.

**Left short**

- `nfc list` with a badge resting on the reader is 69 ms against the ~35 ms measured on an empty reader (§9).
- The kiosk drops a frame of 66–100 ms when a tap's ring flashes on a port (the same GPU re-raster as the blocks);
  blocks no longer do.
- The last station firmware (a chip that misses R(NAK) is re-read instead of counted gone) passed its host tests and
  a clean build and was flashed, but the badges had been taken off the readers by then, so it hasn't met a badge.
- The live demo: `game-ui` moved on to a new look while this branch was built, and the demo at
  https://ethereum-game-box.pages.dev/ runs it. This branch's demo build was not deployed over it; merging `game-ui`
  in is the team's call (it removes the demo desk and parts this branch changed).

**What still needs people, or a chain**

- Real taps with a hand: everything here used injected taps or the badges resting on the readers. The team should
  tap both games for real, including Quick Draw's reaction times and a badge lifted mid-roll.
- A station's BOOT press timed through the Box, and the bench with the Bluetooth speaker playing (no speaker was
  connected).
- The repo deploy key: `~/.ssh/egb_deploy.pub` on the Pi goes on the repo as a read-only deploy key, then
  `EGB_REPO_URL` in `~/.config/egb/env` and `systemctl --user enable --now egb-update.timer`.
- The chain: stakes, payouts and blocks are simulated behind the core's ports until the contracts, relayer and Box key
  land.

## 14. Done when

**Builds**

- [x] The `box` build runs on the Pi through `LiveLink`.
- [ ] The demo build still runs on `SimLink` and is live. (It runs on `SimLink` and its tests pass; the live demo now
      runs `game-ui`'s new look, so this branch's build wasn't deployed over it: §13.)

**Firmware and the bench**

- [x] Both stations and the receiver run the new firmware.
- [ ] The bench meets the targets, and its results are in this plan. (All but `nfc list` with a badge resting, 69 ms
      against ~35 ms; no run with the speaker playing: §9.)

**Hardware behaviour**

- [x] Station OLEDs follow the game (shown with `frame` screenshots).
- [x] Buzz and press work on both stations.

**Games**

- [x] Quick Draw and Stock Duel play end to end on the Pi with injected taps: join, simulated stake, play, result,
      refund.
- [x] They do the same on the laptop with `EGB_RECEIVER=fake`.
- [x] Quick Draw judges by touch time.
- [x] Stock Duel's stat comes from both badges' verified rolls.

**Taps**

- [x] An unknown badge is read whatever the plan, and a known one costs no chip command.
- [x] Every `touch` ends in `done` or `fail`, even when the receiver drops.

**Built games**

- [x] A game built on the Pi with the `claude` provider installs, shows as a cartridge and plays end to end on the Pi.
- [x] Its rules run in the sandboxed child.
- [x] Tests prove every refusal for the rules child and the frame.
- [x] The confinement and bundler-guard tests pass.
- [x] Mock voice drives a Designer session.

**Pi state**

- [x] The old units are disabled, and how to re-enable them is noted.
- [x] The new units are enabled, so the Pi boots into the new Box.

**Firmware code**

- [x] Host tests pass, and no `String`, heap printf or busy wait sits on a hot path.

**Repo**

- [x] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm firmware:test` pass; `pnpm firmware:build` compiles clean.
- [x] The deploy scripts pass `shellcheck`.
- [x] Every module is documented in its README, and the root README layout is updated.
- [x] Nothing in the repo or its history points at an outside workspace or carries borrowed names.
