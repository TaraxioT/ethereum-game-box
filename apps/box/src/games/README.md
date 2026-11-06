# Games

The team games' rules and screens, one folder each. Rules are pure (`(state, event) → state`, `GameRules` from
`@egb/sdk`): time, seeds and badge rolls arrive in events, and every rule is tested. The core (`src/core/`) steps them
and hands them each tap's touch time; the screens are documented in `src/screen/README.md`. Reshaping them into the
module shape (game.json, BLUEPRINT.md, a frame screen) comes with the rules runner.

## Quick Draw (`quick-draw/`)

Best of three standoffs; the first to take two rounds takes the match. Each standoff is counted in (`COUNT_MS`, 3 s:
3, 2, 1), then the sign reads WAIT… and flips to DRAW 2–6 s later (from the seed and the standoff's number); the
first chip to touch after the flip takes the round. A touch before it, on WAIT… or on a decoy, is a foul: the round
goes to the other seat. A decided round is held `ROUND_MS` (3.2 s), then the next is counted in. Its taps are
`identify`.

- **Decoys.** Some standoffs (about half) flash one or two red decoy words on the sign during the wait (`DRAG`,
  `DRAT`, `DREW`, `DRIP`, `DRUM`), each `DECOY_MS` (700 ms), never in the first 700 ms nor in the 800 ms before DRAW.
  They are only pictures: any touch before `drawAt` is the same foul. `decoyAt(state, now)` says which shows.
- **Judged by touch time**, never by the order taps arrive in: each event carries `at` (when the chip touched) and
  `now` (when the Box hears of it). A foul is a foul by `at < drawAt`, even when the Box hears of it after the flip.
  A touch in the countdown (`at < startedAt`) or between rounds changes nothing.
- **Waiting for certainty.** A good tap waits `SETTLE_MS` (450 ms) from its touch for the other station's touch, which
  may still arrive with an earlier time; with both taps in it is judged at once. A foul is judged at once. A chip
  still being read (`touch`, before its `tap` or `release`) that touched earlier than the first tap is waited for, at
  most `READ_WAIT_MS` (1500 ms) from its touch.
- **Rounds nobody takes.** A dead heat to the millisecond, or nobody touching within `TOO_SLOW_MS` (4000 ms) of the
  draw, gives nobody the round and it is played again.
- **An end.** After `MAX_STANDOFFS` (6) standoffs the match ends anyway: the one ahead wins, level is a draw (both
  stakes back). Nothing changes once it is done.
- The speaker never says GO (it lags): DRAW is a picture. The countdown is to the start of the wait, never the draw.

| Module | What it is |
|---|---|
| `types.ts` | `QuickDrawState` (phase `count`/`wait`/`draw`/`round`/`done`, standoff, round, score, the count, start and draw times, the decoys, each seat's tap and pending touch, who took the last standoff and how, the match's winner), `QuickDrawEvent` (`tick`, `touch`, `tap`, `release`). |
| `rules.ts` | `rules`, `reactionMs`, `decoyAt`, `fouler`, the timings. Tested in `rules.test.ts`. |

## Stock Duel (`stock-duel/`)

Four stocks each on a Rolodex; a tap plays the card in front; both badges' rolls pick the stat after both cards are
down; the higher number takes the round, best of three. Its taps are `random`.

- **A tap in three parts.** `touch` freezes that seat's front card on the card the player saw (`SHOW_LAG_MS` before
  the touch) and stops its ring; `tap` (the chip's verified roll is back) plays the held card at the touch time with
  that roll; `release` (the tap failed) lets the drum turn on.
- A seat still rolling when the other seat's deadline passes is waited for, so its tap plays what it holds; a card held
  past `HOLD_MAX_MS` (6 s) is let go, so a lost tap can't stall the round.
- The stat is `STATS[(roll1 + roll2) % 4]`, from the two seats' latest rolls; a card played for a seat when its time
  ran out keeps that seat's previous roll.

| Module | What it is |
|---|---|
| `types.ts` | `StockDuelState` (hands, the drums, played and held cards, rolls, the stat, the history), `StockDuelEvent` (`tick`, `touch`, `tap`, `release`); `Stock` and `StatKey` are the deck's (`built/deck.ts`). |
| `rules.ts` | `rules`, `frontIndex`, `frontCard`, `frontRemainingMs`, the timings. Tested in `rules.test.ts`. |
| `deck.ts` | The 20-stock deck with recorded numbers, `STATS`, `STAT_LABEL`, `formatStat`. |
