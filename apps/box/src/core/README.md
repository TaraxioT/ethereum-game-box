# The core

The Box's phase machine (boot → attract → home → join → stake → playing → result | refund, home ⇄ build and home ⇄
lobby ⇄ stake), with its transactions on screen, station views and bot. Money is on chain, behind the chain port:
USDC stakes in a pot, the result that settles it, the lobby's top-ups and player names. It has no DOM, no Node APIs and no clock of its own: it
reaches the world only through `CorePorts` (`ports.ts`). Two hosts run it: `SimLink` in the browser for the demo
(`screen/link/sim.ts`) and the Box server on the Pi (`server/box.ts`). `tsconfig.core.json` checks it with ES2023
alone (no DOM, no Node types, no timers), so anything platform-bound fails the check.

## The ports

| Port | What the core does with it |
|---|---|
| `clock` | `now()` for every time it reads, `after` / `every` / `cancel` for every timer (the block clock, gas drift, game ticks, the end hold, Join's settle, the idles). |
| `stations` | `show(seat, view)` whenever a station's view changes (and once at start); `buzz(seat, "ok" \| "no")` for every judged tap. |
| `chain` | The chain behind the money (`ChainPort`): `balance`, `player` (balance and player name) and `board` (the title and the open championship) are reads; `open` (both stakes into the pot), `settle` (the result), `refund`, `topup` and `claim` are sends that never wait, each step coming back through its watch; `outcome` reads what a paid result did; `watchHead` drives the block clock; `nextRound` (kept on disk on the Box, never repeated) and `refundAfterMs`; `onChain(game)`: a built game isn't, and plays for nothing. The Box runs Sepolia through the relayer (`src/chain/`); the demo and the tests run `demo-chain.ts`. |
| `library` | `games()` for the rack; `subscribe` for installs and removals (a `games` event). A `GameInfo` carries its checked game.json (`manifest`) and, for a game that should play but can't, why (`sealed`). |
| `rules` | Built games' rules, run outside the core (the server's sandboxed children): `prepare` at Join, `start` when the match opens, `step` for each tick and tap; any rejection voids the match. Absent in the demo, where built games can't be played. |
| `log` | `record(transcript)` once per match, after its end hold; `countedSince(pair, since)` for the per-pair cap. The demo keeps nothing. |
| `random` | uint32s for match seeds and the lobby's proposed labels. Never a game's outcome on a real Box: badges roll those. |

## Taps

A tap comes in as a `TapEvent` (`ports.ts`): a `touch`, then exactly one `done` or `fail`, sharing an id, with its
source: `station` (the taps library, which numbers them) or `injected` (the test page, Demo mode's screen taps and
bot, which take ids from `core.nextTap()`). Only station taps are evidence for a counted result.

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

## Stakes, results and the lobby

- **What it's played for** (`playFor`). Play starts every game at its default stake (10 USDC), played for USDC.
  On Stake, `stake` picks 5, 10 or 25 USDC; `play-for` picks the `title` or the `cup` (only while the game's
  championship is open; one that closes before anyone signs falls back to the title). The modes stake amounts of
  their own (`MODE_STAKES`: the title 20 USDC each, the championship 15; `stakeOf`), into the same pot. Every result
  takes the title and scores the open championship, whatever it was played for. The match keeps what it was played
  for (`match.playFor`).
- **The boards** (`boards`, and `board`: the chosen game's, in the lobby the focused game's, or Stock Duel's for a
  game not on chain). Every on-chain game's title and open championship, read together when Stake, the lobby or the
  result opens and every `BOARD_MS` (5 s) while it shows, and on a tap once the last read is that old.
- **Names on taps** (`taps`). Each station's last tap by a known badge, with its ENS name: read from chain on the tap
  if the Box doesn't know it (a `name` event when it lands). `honours.ts` says which titles a name holds and which
  championships it leads, so the screen shows them with it.
- **Stake.** A seated badge's balance and player name are read from chain when it sits down and again at Stake. A
  Stake tap whose balance can't cover the stake (or isn't read yet), or with no player name where the port stakes only
  named badges (`stakeNeedsName`: Sepolia's `DuelPot` refuses `NotAPlayer`), is refused and opens the lobby on that
  badge, with Back returning to Stake. Join and Stake go Home after `SEATED_IDLE_MS` (2 minutes) with no tap or touch,
  dropping a lone signature, so seats left by players who walked away don't greet the next ones (or a restarted
  screen) and don't keep the updater waiting; not while both have signed and the pot is opening.
- **Open.** When both seats have signed, the stakes go to the pot (`open`, a Box-signed `Stake` with the round from
  `nextRound`) and the Box waits on Stake until the open is confirmed (the relayer's `done`: a block past the one it is
  in): only then does the match begin. The screen shows the wait in the game's own screen (Quick Draw's walk-out, Stock
  Duel's pre-market), with the open's progress (SIGNED › SENT › IN BLOCK › CONFIRMED, its hash and the seconds so far).
  Taps and Back do nothing while it waits. An open that fails sends both seats back to sign again, with nothing staked.
- **Result.** After the end hold the result (`settle`, the same round) goes once the pot has landed, so it settles the
  pot it belongs to; it goes even after a rematch or a reset, and with nothing paid when the pot never opened. Once it
  is paid, `outcome` reads its lines from chain at the receipt (the payout, the title, the championship) into
  `match.lines`: never from local state. Money on its way to a badge shows as `pending` until its transaction ends,
  and every balance it touched is read again.
- **Refund.** With the power off the Box misses its settle: Refund opens `refundAfterMs` after the open (an hour on
  Sepolia), and either seat's tap sends one refund for the whole pot, then Home. A pot the players walk away from, or
  one left by a reset, stays on chain until the server refunds it.
- **Lobby** (`lobby` from Home, or a short Stake tap). Any station's tap shows that badge's card: its player name, its
  stats over every game (`PlayerRecord`, from its name's `stats` record) and USDC. A badge with no name is offered its own label first (the roster's word; the demo's badges are `nova`, `kite`
  and `juno`), `propose` gives another (`comet-42`), and `claim` sends it; `topup` sends 100 USDC. The board
  shows the focused game's title and cup, and the leaderboard over every game (`Board.leaders`). It goes Home
  after `IDLE_MS` alone.
- **Hall** (`hall` from Home or Attract). Every on-chain game's board: its title with when it lapses
  (`Board.title.expires`), its open cup, its closed cups (`Board.won`, each name its winner's for good) and the
  leaderboard, read every `BOARD_MS` while it shows. A tap takes a seat, as on Home. `challenge` (from a title or cup
  card, here or on Home's board) brings the game into focus and plays it for the title or the open cup at its stake:
  Stake when both seats are taken, else Join. BACK, or `IDLE_MS` alone, goes Home.
- **EXIT** (`quit` while a match runs). A team game's match is called off (`Match.calledOff`) and ends as a draw: its
  result settles on chain as one, so both stakes go back at once and the players' stats count a draw. A built game's is
  void, as when its rules fail.

## Built games

A built game's rules run outside the core, through `RulesRunnerPort` (`built.ts` drives it):

- Play on a built game starts its child at once (`prepare`), at Join, so the first step pays no start-up cost; a
  rematch prepares it again, and going Home stops it.
- A built game isn't on chain: it plays for nothing (stake 0, no pot, no result sent). When both seats sign, the
  core asks the rules to `start` with the match's seed; the match opens (`playing`) on
  their first state. The play is `{ game: "built", id, state, stations }`: the rules' state as they returned it (the
  kiosk's frame draws it) and their two station views, which the stations show as they are, tag and tap words
  included.
- Every `TICK_MS` a tick goes to the rules, unless a step is still out (ticks only move the clock on). Taps go to them
  as finished taps (`BuiltEvent`), judged at their touch time: a known badge's at its touch when the game.json's taps
  are `identify`; otherwise on the chip's `done`, with its verified roll when they are `random`. A tap is never dropped.
- Any rejection (over budget, a throw, a crash or exit, a broken protocol) voids the match: `voided`, a draw nobody
  played, the stations read `VOID`, and after the end hold the transcript's result is `void` (it never counts). Rules that fail to start void the match before it plays: straight to Result.
- A snapshot or failure from a match that is over, or that a reset overtook, never reaches the next one.

## The build phase

On a Box with the game builder (`createCore(ports, { builder: true })`, the server; the demo has none), Home's NEW
GAME sends `{ type: "build" }` and the Box enters `build`: the Designer and the Build screen. `home` or `back` returns.
While building, taps plan `none` and any that come are refused (two buzzes); the seats stay as they were, and the
stations read `NEW GAME`. The phase goes back to Home after `BUILD_IDLE_MS` (5 minutes) with no screen command; the
builder's views send `build` again as the player works and as a build streams in, so only a builder left alone times
out (a build that is running carries on). Whether a game is being built is the server's to know (`/api/state`'s `busy`),
not the core's.

## Matches and records

Every match is written to the match log after its end hold, as `@egb/sdk`'s `Transcript`: the seed, both badges, the
stake, when it started and ended, each game tap (touch time, roll, taken or not) and the result. It counts toward
records only on taps the Box saw (`transcript.ts`): both seated badges tapped a station from Stake to the end, at least
12 s passed since the first of those taps, and the pair has had fewer than 12 counted results in the hour before.

`core.reset()` (the test page) goes back to Home at once. A pot that never settles stays on chain until its refund
opens; a result already decided is still sent once its pot lands.

## Modules

| Module | What it is | API |
|---|---|---|
| `types.ts` | The screen's interface to the Box: `BoxLink` (`state`, `now`, `subscribe`, `send`), `BoxState` (with `lobby`, `playFor` and `board`), `BoxEvent` (a `tap` says what it did, its `TapMeaning`; a `touch` is a chip still being read; a `cue` is a match's moment with its seat, which the screen turns into sound), `ScreenCommand` (`lobby`, `topup`, `propose`, `claim` among them), `GameInfo` (`kind: "team" \| "built"`, `icon` for a built game's art, `sealed`, `manifest`), `SeatState` (`ens`, `balance` in USDC or null before its read, `pending`), `PlayFor`, `Match` (`playFor`, `round`, `refundAt`, `voided`, `lines`), `MatchPlay` (with `BuiltPlay`), `Tx` (`hash`, `etherscan`, `error`; steps up to `paid` or `failed`), `Lobby`, `PlayerCard`, `Board`, `Standing`. `StationView` is `@egb/sdk`'s. | types |
| `ports.ts` | `CorePorts` and the types that cross them: `Clock`, `StationsPort`, `ChainPort` (with `StakeOrder`, `ResultOrder`, `ChainHead`, `ChainTxUpdate`, `TxWatch`), `LibraryPort`, `RulesRunnerPort`, `MatchLog`, `TapEvent`, `TapPlan`. | types |
| `wire.ts` | The link's messages (`LinkDown`, `LinkUp`), `LINK_PATH`, `LINK_COALESCE_MS`, and `STATE_ONLY`: the one event that goes out as a coalesced `state` message. | types, constants |
| `core.ts` | The phase machine on its ports. | `createCore(ports, { bot?, builder? }): Core` (`BoxLink` plus `tap(event, source)`, `plan`, `nextTap`, `opponent` / `setOpponent`, `power` / `setPower`, `reset`, `stop`); the timing constants (`END_HOLD_MS`, `JOIN_SETTLE_MS`, `BUILD_IDLE_MS`, …). |
| `built.ts` | A built game's match through the rules runner: a start, then ticks (skipped while a step is out) and taps (never), each snapshot handed on, the first failure once. | `startBuilt(rules, game, seed, now, { snapshot, failed }): BuiltDriver` |
| `plan.ts` | What a tap at each seat asks of the badge, from the state and the time. Pure. | `tapPlan(state, seat, now)`, `REMATCH_TAP_MS` |
| `transcript.ts` | A finished match as its transcript, and whether its result counts. Pure. | `transcriptOf`, `counts`, `FREE_MIN_MATCH_MS`, `FREE_PER_PAIR_HOUR` |
| `stations.ts` | Each station's view from the state: the seat's tag, a big line and a small one, and the `done` / `sign` overrides. Pure. | `stationView(input, seat, now)`, `stationViews` |
| `catalogue.ts` | The team games in rack order (two playable, two sealed), the default focus, the team library, and each team game's label on chain (`stockduel`, `quickdraw`). | `TEAM_GAMES`, `DEFAULT_FOCUS`, `teamLibrary()`, `isTeamGame`, `defaultStake`, `MODE_STAKES`, `stakeOf`, `chainLabel`, `gameOfLabel` |
| `txs.ts` | The transactions on screen: signed at once, then each step its chain port reports (sent, in a block, paid, or failed, keeping the hash, block and Etherscan link), `ended` once, then on screen `LINGER_MS` more. | `createTxBook(hooks, clock)` |
| `demo-chain.ts` | The chain port in memory, for the browser demo and the tests: a head every 12 s, every badge starting with 100 USDC, each transaction sent 0.4 s after it is signed, in the next head, paid 0.9 s later, with no hashes; pots refund after a minute; names, top-ups and a title per game. `sent` lists every request. | `createDemoChain(clock)` |
| `labels.ts` | The short words badges are named with: the roster's local labels, and the lobby's proposals (a badge's own label first, then `word-NN`), each a valid ENS label. Pure. | `LABELS`, `ownLabel`, `proposeLabel` |
| `bot.ts` | The demo's bot on Player 2: a pure planner (what it waits to tap, and how long a person would take) and a scheduler on the core's clock. | `botIntent`, `botDelay`, `createBot` |
| `badges.ts` | The badges Demo mode taps with and the bot's; how a station or port prints a badge; when two are the same. | `DEMO_BADGES`, `BOT_BADGE`, `badgeLabel`, `sameBadge` |
| `instant-tap.ts` | A whole injected tap at once (touch, then done, with the roll only if the plan asks): Demo mode's screen taps, the bot and the server's injected taps. | `instantTap(core, seat, badge, roll)` |
| `timers.ts` | Timers on the core's clock that one call cancels together. | `createTimers(clock)` |
| `fake-clock.ts` | A clock moved by hand, for tests: timers fire in due order, each at its own time. | `createFakeClock(start)` |
| `system-clock.ts` | The real clocks, for the hosts. `monotonicClock()` (the server, the taps, the bench): the wall time at start, then monotonic, so an NTP step never moves touch times against the game's timers. `systemClock()` (SimLink): the wall clock. Left out of the core's own check, and never imported by the core. | `monotonicClock()`, `systemClock()` |

Tests: `core.test.ts` drives whole matches through the ports on a fake clock, on the demo chain or on a recording port
whose transactions a test moves step by step (judged by touch time, an unknown chip's earlier touch waited for, rolls
from `done`, a frozen card let go on `fail`, refusals, dropped stale taps, transcripts and their counting, the rematch
tap, station pushes, balances and names read from chain, the head, the library; stakes on chain: the match open at
once with the bar following the pot, the result only after the pot lands with the same round and its lines from
`outcome`, a failed pot still reported, a result sent after a rematch, a round per match, a short or unread balance
sent to the lobby and back; the lobby: cards at either station with nova, kite and juno proposed, another label, a
claim, a top-up, the board of the focused game, its idle; Refund after its delay with one refund for both; reset
leaving the pot on chain; the build phase: only on a Box with the builder, taps refused, its idle); `bot`,
`demo-chain`, `labels`, `stations`, `transcript` and `txs` have their own; `system-clock.test.ts` checks the server's clock ignores a step of the
wall clock (it is left out of the core's check, with the clocks); `built.test.ts` plays a built game on a fake rules
runner (prepared at Join, opened on the first state, taps at their touch time with the roll for `random`, the rules'
stations, played for nothing with no request to the chain, a void mid-game and at start, the child stopped at Home).
