# Quick Draw (blueprint)

A standoff at dusk for two badges. The sign reads WAIT…, then turns over to DRAW! after a delay nobody can predict;
the first badge to touch its station after the turn wins, and a badge that touches before it loses.

- Kind: team game. Its rules run in the Box's core (`rules.ts`, events in `types.ts`); its screen is a kiosk view
  (`screen.ts`). `built/` is the same game as a built game, the form the Forge starts from (the default template).
- Tier: **refereed**. Only the Box's stations saw the touches; nothing on a chain can recompute a reaction time.
- Taps: `identify`. Only who touched and when matter, and a badge the Box already knows costs no chip command, so a
  touch is judged the moment it lands.

## The rule (exact)

- A standoff starts at `now`; the sign turns at `drawAt = now + MIN_WAIT_MS + ⌊r × (MAX_WAIT_MS − MIN_WAIT_MS + 1)⌋`
  (2000 to 6000 ms), with `r` the first number of `mulberry32` seeded from the match seed (the first standoff) or
  `hash32(seed, standoff)` (a later one).
- Every tap is judged by its touch time (`at`), never by the order taps reach the Box: the two stations and the two
  chips don't finish in step.
- The earliest touch decides:
  - before `drawAt`: a false start, judged at once. The **other** seat wins.
  - at or after `drawAt`: that seat wins, once its touch is certain to be the first.
- Certain means: a good touch waits `SETTLE_MS` = 450 ms from its own touch for the other station, whose touch may
  still come in earlier; both in, it is judged at once. In the team game a chip still being read (a `touch` with no
  `done` yet) that touched earlier is waited for, at most `READ_WAIT_MS` = 1500 ms from its touch.
- Two touches on the same millisecond: a dead heat, nobody wins, both stakes go back.
- Nobody touches within `TOO_SLOW_MS` = 4000 ms of the turn: the standoff is stood again with the next number. The
  built form calls the match a draw after `STANDOFFS` = 3 standoffs nobody drew in, so every match ends.
- A touch from before the standoff began, and a seat's second touch, change nothing.

## The flow

Join (both badges tap) → Stake (both tap to sign) → the walk-out while the stakes go in → the standoff → the result
held ~2.4 s → Result. A seated badge's
tap within `REMATCH_TAP_MS` = 4000 ms of the result asks for a rematch (the team game).

## The screen

While both stakes go into the pot (from the second signature until the open is confirmed on chain), the team screen plays
the walk-out: the two stand back to back at the sign's post, pace ten paces apart as the sign counts them, turn, and
each raises a revolver and thumbs its hammer back (a click), then holsters it; the sign reads READY and a brass wire
plate over it follows the transaction. The standoff starts only once the stakes are confirmed, never before: a walk not yet done hurries to the
marks. Nothing in the walk-out is timed to the draw.

The team screen draws the standoff in flat layered silhouette: the light dims from the standoff's start over the
longest possible wait (the same for every match, so it never gives the turn away), the sign turns over on its pins,
the winner fires and smoke curls off the barrel, the loser is hit (rocks back, the hat flies, the knees go, the figure
falls forward), and a brass plate under each figure shows its reaction time. Each gunslinger is drawn in layers that
move on their own (legs, body, the gun arm's three poses, hat): Player 1 in a duster and cattleman's hat, Player 2 in
a short jacket, chaps and a flat-crowned hat. The built screen keeps the idea with
the Box's parts: a metal plate reading WAIT… that turns to a brass DRAW!, a dimming dusk, an amber `<egb-seg>`
reaction time under each seat, and a brass plate naming the winner. Both turn the sign on the Box's clock at
`drawAt`, not when the next state arrives.

## Station text

| When | Big | Small |
|---|---|---|
| waiting | `WAIT` | `tap on DRAW` |
| after the turn | `DRAW!` | `tap now` |
| tapped, being judged (built) | `WAIT` | `judging` |
| won / lost | `WIN` / `LOSE` | `214 ms`, `too early` or `no tap` |
| dead heat or no draw (built) | `TIE` | as above |

Tags are `P1` / `P2`. The station's own `DONE` names the badge.

## What a remix may change

- The waits (`MIN_WAIT_MS`, `MAX_WAIT_MS`), `TOO_SLOW_MS`, `STANDOFFS`.
- The foul rule: give the match away (the default) or only cost the fouler that standoff.
- The theme: what the sign is, the GO word, the colours, the words on the stations.
- A twist that stays a reaction test: a decoy word before the real one, two signals, a shorter wait each standoff.

## What it must keep

- Judging by touch time against a turn on the Box's clock, never by arrival order.
- The settle wait (`SETTLE_MS`), or a slower station decides matches.
- An end: a time limit as well as a win condition.
- No claim of proof: the Box referees it.

## Pitfalls

- Never say GO on the speaker: it lags ~200 ms. The turn is a picture.
- Don't count down to the turn on screen: the delay must be unpredictable.
- A badge left on the station after the result must not start or skip anything.
