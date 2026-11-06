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
| `ledger` | `load()` once at start; `save(ledger)` after every change (faucet, stake lock, settle, refund). A stake still in escrow at start belonged to a match the Box lost when it stopped: each goes straight back to the badge that put it in (the escrow keeps every stake under its badge for this), as its refund would have paid it. |
| `library` | `games()` for the rack; `subscribe` for installs and removals (a `games` event). |
| `rules` | Built games' rules (later steps); absent in the demo. |
| `log` | `record(transcript)` once per match, after its end hold; `countedSince(pair, since)` for the per-pair cap. The demo keeps nothing. |
| `random` | uint32s for match seeds and the simulated chain's gas. Never a game's outcome on a real Box: badges roll those. |

## Taps

A tap comes in as a `TapEvent` (`ports.ts`): a `touch`, then exactly one `done` or `fail`, sharing an id, with its
source: `station` (the taps library, which numbers them) or `injected` (the test page, the demo's desk and bot, which
take ids from `core.nextTap()`). Only station taps are evidence for a counted result.

- `core.plan(seat)` says what a tap at that seat should ask of the badge now: `identify` (who), `random` (a verified
  roll, only when the game uses it: Stock Duel's pick) or `none` (the tap means nothing now). The taps library asks
  after each touch, and reads an unknown chip whatever the plan.
- A tap is judged at its touch time (`at`). Outside a game, a known badge whose plan isn't `random` is acted on at its
  touch; a `random` tap, or a chip the roster didn't know (`badge: null`), waits for its `done`.
- In a game, the game hears the touch at once. Quick Draw takes a known seated badge's touch as its tap; an unknown
  chip's touch waits, pending, until its read says whose it is (the rules may wait for it: an earlier touch may be
  first). Stock Duel freezes the card the player saw on `touch`, plays it at the touch time with the chip's roll on
  `done`, and lets it go on `fail`, or when the chip turns out not to be the seated badge.
- A `fail` on a tap still waiting is a refusal (two buzzes). A `done` for a tap that touched before the phase changed
  is dropped, so a stake tap that finishes after the match opened never reaches the game.
- On the result, a seated badge's tap is a rematch, but only `REMATCH_TAP_MS` (4 s) after the game ended: a chip left
  on the reader must not skip the result.

## Matches and records

Every match is written to the match log after its end hold, as `@egb/sdk`'s `Transcript`: the seed, both badges, the
stake, when it started and ended, each game tap (touch time, roll, taken or not) and the result. It counts toward
records only on taps the Box saw (`transcript.ts`): both seated badges tapped a station from Stake to the end, at least
12 s passed since the first of those taps, and the pair has had fewer than 12 counted results in the hour before.

`core.reset()` (the test page) goes back to Home at once: a match that hasn't sent its settlement hands each stake
back; an open transaction still on its way locks nothing when it lands.

## Modules

| Module | What it is | API |
|---|---|---|
| `types.ts` | The screen's interface to the Box: `BoxLink` (`state`, `now`, `subscribe`, `send`), `BoxState`, `BoxEvent`, `ScreenCommand`, `GameInfo` (`kind: "team" \| "built"`, `icon` for a built game's art), `Match`, `Tx`. `StationView` is `@egb/sdk`'s. | types |
| `ports.ts` | `CorePorts` and the types that cross them: `Clock`, `StationsPort`, `LedgerStore`, `LibraryPort`, `RulesRunnerPort`, `MatchLog`, `TapEvent`, `TapPlan`. | types |
| `wire.ts` | The link's messages (`LinkDown`, `LinkUp`), `LINK_PATH`, `LINK_COALESCE_MS`, and `STATE_ONLY`: the one event that goes out as a coalesced `state` message. | types, constants |
| `core.ts` | The phase machine on its ports. | `createCore(ports, { bot? }): Core` (`BoxLink` plus `tap(event, source)`, `plan`, `nextTap`, `opponent` / `setOpponent`, `power` / `setPower`, `reset`, `stop`); the timing constants (`END_HOLD_MS`, `JOIN_SETTLE_MS`, …). |
| `plan.ts` | What a tap at each seat asks of the badge, from the state and the time. Pure. | `tapPlan(state, seat, now)`, `REMATCH_TAP_MS` |
| `transcript.ts` | A finished match as its transcript, and whether its result counts. Pure. | `transcriptOf`, `counts`, `FREE_MIN_MATCH_MS`, `FREE_PER_PAIR_HOUR` |
| `stations.ts` | Each station's view from the state: the seat's tag, a big line and a small one, and the `done` / `sign` overrides. Pure. | `stationView(input, seat, now)`, `stationViews` |
| `catalogue.ts` | The team games in rack order (two playable, two sealed), the default focus, the team library. | `TEAM_GAMES`, `DEFAULT_FOCUS`, `teamLibrary()`, `isTeamGame`, `defaultStake` |
| `chain.ts` | The simulated chain: a block every 12 s from Sepolia's real height, gas that wanders. Pure. | `blockAt`, `nextBlockAt`, `nextGas`, `firstGas` |
| `ledger.ts` | The simulated EGB ledger (faucet, escrow kept per badge, settle, refund, every stake back). Pure. | `faucet`, `lock`, `settle`, `refund`, `returnAll`, `escrowTotal`, `memoryLedgerStore()` |
| `txs.ts` | Simulated transactions and their timing on the core's clock: signed, sent 0.4 s later, in the next block, paid 0.9 s after it. | `createTxBook(hooks, clock)` |
| `bot.ts` | The demo's bot on Player 2: a pure planner (what it waits to tap, and how long a person would take) and a scheduler on the core's clock. | `botIntent`, `botDelay`, `createBot` |
| `badges.ts` | The demo desk's badges and the bot's; how a station or port prints a badge. | `DESK_BADGES`, `BOT_BADGE`, `badgeLabel` |
| `instant-tap.ts` | A whole injected tap at once (touch, then done, with the roll only if the plan asks): the desk, the bot and the server's injected taps. | `instantTap(core, seat, badge, roll)` |
| `timers.ts` | Timers on the core's clock that one call cancels together. | `createTimers(clock)` |
| `fake-clock.ts` | A clock moved by hand, for tests: timers fire in due order, each at its own time. | `createFakeClock(start)` |
| `system-clock.ts` | The real clock, for the hosts (SimLink, the server, the taps). Left out of the core's own check, and never imported by the core. | `systemClock()` |

Tests: `core.test.ts` drives whole matches through the ports on a fake clock (judged by touch time, an unknown chip's
earlier touch waited for, rolls from `done`, a frozen card let go on `fail`, refusals, dropped stale taps, transcripts
and their counting, the rematch tap, the stranded escrow returned, reset, station pushes, the ledger store, the
library); `bot`, `chain`, `ledger`, `stations`, `transcript` and `txs` have their own.
