# The core

The Box's phase machine (boot → attract → home → join → stake → playing → result | refund), with its simulated
ledger, chain clock, transactions, station views and bot. It has no DOM, no Node APIs and no clock of its own: it
reaches the world only through `CorePorts` (`ports.ts`). Two hosts run it: `SimLink` in the browser for the demo
(`screen/link/sim.ts`) and the Box server on the Pi (`server/box.ts`). `tsconfig.core.json` checks it with ES2023
alone (no DOM, no Node types, no timers), so anything platform-bound fails the check.

## The ports

| Port | What the core does with it |
|---|---|
| `clock` | `now()` for every time it reads, `after` / `every` / `cancel` for every timer (the block clock, gas drift, game ticks, the end hold, Join's settle, Home's idle). |
| `stations` | `show(seat, view)` whenever a station's view changes (and once at start); `buzz(seat, "ok" \| "no")` for every judged tap. |
| `ledger` | `load()` once at start; `save(ledger)` after every change (faucet, stake lock, settle, refund). |
| `library` | `games()` for the rack; `subscribe` for installs and removals (a `games` event). |
| `rules` | Built games' rules (later steps); absent in the demo. |
| `log` | Match transcripts (later steps); the hosts pass a no-op until then. |
| `random` | uint32s for match seeds and the simulated chain's gas. Never a game's outcome on a real Box: badges roll those. |

## Taps

A tap comes in as a `TapEvent` (`ports.ts`): a `touch`, then exactly one `done` or `fail`, sharing an id from
`core.nextTap()`. Every source of taps (the stations, injected taps, the demo desk, the bot) takes its ids there, so
they never collide.

- `core.plan(seat)` says what a tap at that seat should ask of the badge now: `identify` (who), `random` (a verified
  roll, only when the game uses it: Stock Duel's pick) or `none` (the tap means nothing now). The taps layer asks
  just before it sends the `touch`, and reads an unknown chip whatever the plan.
- A tap is judged at its touch time (`at`). A known badge whose plan isn't `random` is judged on its `touch`: Quick
  Draw's reaction time is the touch's. A `random` tap, or a chip the roster didn't know (`badge: null`), waits for
  its `done`, which brings the badge and its roll; it is still judged at the touch's `at`.
- A `fail` on a tap still waiting is a refusal (two buzzes). A `done` for a tap that touched before the phase changed
  is dropped, so a stake tap that finishes after the match opened never reaches the game.

Step 4 adds the finer touch rules (Quick Draw's 450 ms settle for the second station, Stock Duel freezing the front
card on `touch`) inside the games' rules; the core already hands them the touch time and the roll.

## Modules

| Module | What it is | API |
|---|---|---|
| `types.ts` | The screen's interface to the Box: `BoxLink` (`state`, `now`, `subscribe`, `send`), `BoxState`, `BoxEvent`, `ScreenCommand`, `GameInfo` (`kind: "team" \| "built"`, `icon` for a built game's art), `Match`, `Tx`. `StationView` is `@egb/sdk`'s. | types |
| `ports.ts` | `CorePorts` and the types that cross them: `Clock`, `StationsPort`, `LedgerStore`, `LibraryPort`, `RulesRunnerPort`, `MatchLog`, `TapEvent`, `TapPlan`. | types |
| `wire.ts` | The link's messages (`LinkDown`, `LinkUp`), `LINK_PATH`, `LINK_COALESCE_MS`, and `STATE_ONLY`: the one event that goes out as a coalesced `state` message. | types, constants |
| `core.ts` | The phase machine on its ports. | `createCore(ports, { bot? }): Core` (`BoxLink` plus `tap`, `plan`, `nextTap`, `opponent` / `setOpponent`, `power` / `setPower`, `stop`); the timing constants (`END_HOLD_MS`, `JOIN_SETTLE_MS`, …). |
| `plan.ts` | What a tap at each seat asks of the badge, from the state. Pure. | `tapPlan(state, seat)` |
| `stations.ts` | Each station's view from the state: the seat's tag, a big line and a small one, and the `done` / `sign` overrides. Pure. | `stationView(input, seat, now)`, `stationViews` |
| `catalogue.ts` | The team games in rack order (two playable, two sealed), the default focus, the team library. | `TEAM_GAMES`, `DEFAULT_FOCUS`, `teamLibrary()`, `isTeamGame`, `defaultStake` |
| `chain.ts` | The simulated chain: a block every 12 s from Sepolia's real height, gas that wanders. Pure. | `blockAt`, `nextBlockAt`, `nextGas`, `firstGas` |
| `ledger.ts` | The simulated EGB ledger (faucet, escrow, settle, refund). Pure. | `faucet`, `lock`, `settle`, `refund`, `memoryLedgerStore()` |
| `txs.ts` | Simulated transactions and their timing on the core's clock: signed, sent 0.4 s later, in the next block, paid 0.9 s after it. | `createTxBook(hooks, clock)` |
| `bot.ts` | The demo's bot on Player 2: a pure planner (what it waits to tap, and how long a person would take) and a scheduler on the core's clock. | `botIntent`, `botDelay`, `createBot` |
| `badges.ts` | The demo desk's badges and the bot's; how a station or port prints a badge. | `DESK_BADGES`, `BOT_BADGE`, `badgeLabel` |
| `instant-tap.ts` | A whole tap at once (touch, then done, with the roll only if the plan asks): the desk, the bot and injected taps. | `instantTap(core, seat, badge, roll)` |
| `timers.ts` | Timers on the core's clock that one call cancels together. | `createTimers(clock)` |
| `fake-clock.ts` | A clock moved by hand, for tests: timers fire in due order, each at its own time. | `createFakeClock(start)` |
| `system-clock.ts` | The real clock, for the hosts (SimLink, the server, the taps). Left out of the core's own check, and never imported by the core. | `systemClock()` |

Tests: `core.test.ts` drives whole matches through the ports on a fake clock (judged by touch time, rolls from
`done`, refusals on `fail`, dropped stale taps, station pushes, the ledger store, the library); `bot`, `chain`,
`ledger`, `stations` and `txs` have their own.
