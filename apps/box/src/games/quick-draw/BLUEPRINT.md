# Quick Draw (blueprint)

A standoff at dusk for two badges, best of three. Each round is counted in (3, 2, 1); the sign reads WAIT…, may flash
a red decoy word, then turns over to DRAW! after a delay nobody can predict. The first badge to touch its station
after the turn takes the round; a badge that touches before it (on WAIT… or a decoy) fouls, its gun blows up, and the
round goes to the other. The first to two rounds wins.

- Kind: team game. Its rules run in the Box's core (`rules.ts`, events in `types.ts`); its screen is a kiosk view
  (`screen.ts`). `built/` is the same game as a built game, the form the Forge starts from (the default template).
- Tier: **refereed**. Only the Box's stations saw the touches; nothing on a chain can recompute a reaction time.
- Taps: `identify`. Only who touched and when matter, and a badge the Box already knows costs no chip command, so a
  touch is judged the moment it lands.

## The rule (exact)

- A match is standoffs, numbered from 1. Standoff `n` is counted in from `now` for `COUNT_MS` = 3000 ms; it begins at
  `startedAt = now + COUNT_MS`; the sign turns at `drawAt = startedAt + MIN_WAIT_MS + ⌊r × (MAX_WAIT_MS − MIN_WAIT_MS
  + 1)⌋` (2000 to 6000 ms), with `r` the first number of `mulberry32` seeded from the match seed (standoff 1) or
  `hash32(seed, n)` (a later one).
- Decoys come from the same generator: while its next number is under 0.5 (at most two), a decoy word (`DRAG`, `DRAT`,
  `DREW`, `DRIP`, `DRUM`) shows for `DECOY_MS` = 700 ms, at least 700 ms into the wait, 500 ms after the last one and
  800 ms before the turn. A decoy is only a picture.
- Every tap is judged by its touch time (`at`), never by the order taps reach the Box: the two stations and the two
  chips don't finish in step.
- The earliest touch decides the standoff:
  - before `drawAt`: a foul, judged at once. The **other** seat takes the round.
  - at or after `drawAt`: that seat takes the round, once its touch is certain to be the first.
- Certain means: a good touch waits `SETTLE_MS` = 450 ms from its own touch for the other station, whose touch may
  still come in earlier; both in, it is judged at once. In the team game a chip still being read (a `touch` with no
  `done` yet) that touched earlier is waited for, at most `READ_WAIT_MS` = 1500 ms from its touch.
- Two touches on the same millisecond (a dead heat), or nobody touching within `TOO_SLOW_MS` = 4000 ms of the turn:
  nobody takes the round, and it is played again.
- `ROUNDS_TO_WIN` = 2 rounds take the match. A decided round is held `ROUND_MS` = 3200 ms, then the next standoff is
  counted in. After `MAX_STANDOFFS` = 6 standoffs the match ends anyway: the one ahead wins, level is a draw and both
  stakes go back. The built form keeps the single standoff and calls the match a draw after `STANDOFFS` = 3 nobody
  drew in.
- A touch in the countdown, between rounds, or a seat's second touch in a standoff changes nothing.

## The flow

Join (both badges tap) → Stake (both tap to sign) → the walk-out while the stakes go in → round 1 (count, standoff,
the round held ~3.2 s) → round 2 → round 3 if it is 1–1 → the result held ~2.4 s → Result. A seated badge's
tap within `REMATCH_TAP_MS` = 4000 ms of the result asks for a rematch (the team game).

## The screen

While both stakes go into the pot (from the second signature until the open is confirmed on chain), the team screen plays
the walk-out: the two stand back to back at the sign's post, pace ten paces apart as the sign counts them, turn, and
each raises a revolver and thumbs its hammer back (a click), then holsters it, while a brass wire plate over the sign
follows the transaction. If the stakes are still on their way after that, the two keep moving on their marks (a slow
step back and in, a gun checked, a hat touched, a tumbleweed, the sun sinking) and the sign holds a word that follows
the transaction (HOLD…, SENT…, BLOCK), never READY. The first round is counted in only once the stakes are confirmed, never
before; a walk not yet done hurries to the marks. Nothing in the walk-out
is timed to the draw.

The team screen says what to do at every moment: a brass round plate with each player's pips (best of 3), a call
strip under the sign (ROUND n · GET READY; WAIT… · DON'T TAP YET; red NOT YET! on a decoy; green DRAW! TAP NOW!; who
took the round), and a bubble over each gunslinger (green TAP! on DRAW, red DON'T! on a decoy). Gold rays burst from
behind the sign at the turn. A foul paints FOUL on the sign in red and blows the fouler's gun up in the hand (blast,
shards, soot, a scorched rim, a stagger).

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
| counting in | `3` / `2` / `1` | `round 2  1-0` (this seat's score first) |
| waiting | `WAIT` | `tap on DRAW` |
| a decoy | `DRAG` (the word) | `don't tap!` |
| after the turn | `DRAW!` | `tap now` |
| round decided | `POINT` / `MISSED` / `AGAIN` | `214 ms`, `foul: too early`, `held fire`, `too slow` or `no tap` |
| tapped, being judged (built) | `WAIT` | `judging` |
| match won / lost | `WIN` / `LOSE` / `DRAW` | as above |
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
- Don't count down to the turn on screen: the delay must be unpredictable. The 3-2-1 counts to the start of the wait.
- A badge left on the station after the result must not start or skip anything.
