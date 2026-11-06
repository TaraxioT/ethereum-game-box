# Games

The team games' rules and screens, one folder each. Rules are pure (`(state, event) → state`, `GameRules` from
`@egb/sdk`): time, seeds and badge rolls arrive in events, and every rule is tested. The core (`src/core/`) steps them
and hands them each tap's touch time; the screens are documented in `src/screen/README.md`. Reshaping them into the
module shape (game.json, BLUEPRINT.md, a frame screen) comes with the rules runner.

## Quick Draw (`quick-draw/`)

A standoff: the sign flips to DRAW 2–6 s after it starts (from the seed); the first chip to touch after the flip wins,
and a touch before it loses. Its taps are `identify`.

- **Judged by touch time**, never by the order taps arrive in: each event carries `at` (when the chip touched) and
  `now` (when the Box hears of it). An early touch is early by `at < drawAt`, even when the Box hears of it after the
  flip.
- **Waiting for certainty.** A good tap waits `SETTLE_MS` (450 ms) from its touch for the other station's touch, which
  may still arrive with an earlier time; with both taps in it is judged at once. A false start is judged at once. A chip
  still being read (`touch`, before its `tap` or `release`) that touched earlier than the first tap is waited for, at
  most `READ_WAIT_MS` (1500 ms) from its touch.
- **Too slow.** Nobody touching within `TOO_SLOW_MS` (4000 ms) of the draw stands the standoff again with a new draw
  time; a touch from the last standoff doesn't count in the new one.
- A dead heat to the millisecond is a draw (both stakes back). Nothing changes once it is done.
- The speaker never says GO (it lags): DRAW is a picture.

| Module | What it is |
|---|---|
| `types.ts` | `QuickDrawState` (phase, standoff, draw time, each seat's tap and pending touch, the winner and why), `QuickDrawEvent` (`tick`, `touch`, `tap`, `release`). |
| `rules.ts` | `rules`, `reactionMs`, the timings. Tested in `rules.test.ts`. |

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
| `types.ts` | `StockDuelState` (hands, the drums, played and held cards, rolls, the stat, the history), `StockDuelEvent` (`tick`, `touch`, `tap`, `release`). |
| `rules.ts` | `rules`, `frontIndex`, `frontCard`, `frontRemainingMs`, the timings. Tested in `rules.test.ts`. |
| `deck.ts` | The 20-stock deck with recorded numbers, `STATS`, `STAT_LABEL`, `formatStat`. |
