# Stock Duel (blueprint)

A card duel with market numbers. Each player's four stocks turn on a Rolodex; a badge tap plays the card in front,
then both badges' verified rolls choose the stat, and the higher number takes the round. First to two rounds.

- Kind: team game. Its rules run in the Box's core (`rules.ts`, state in `types.ts`, the deck in `deck.ts`); its
  screen is a kiosk view (`screen.ts`). `built/` is the same game as a built game, the form the Forge starts from;
  the deck lives there (`built/deck.ts`) and the team game deals from it too.
- Tier: **refereed**. The stat comes from both badges' signed rolls, but which card a tap played is what the Box saw.
- Taps: `random`. Each play is a `sign_random` on the badge's key 2, verified on the Pi; the roll comes back with the
  tap.

## The rule (exact)

- The deck: 20 stocks, each with four stats in roll order: `price`, `avgPrice`, `change24h`, `liquidity`. The
  numbers are frozen in the deck, so every match deals from the same figures.
- Deal: `shuffle(DECK, seed)`; Player 1's hand is the first 4 cards, Player 2's the next 4. The deal lasts `DEAL_MS`
  = 3000 ms; the drums don't turn.
- Pick: each drum shows one card at a time for `DWELL_MS` (2400, 2100, then 1800 ms a card, by round); Player 2's
  drum runs one card ahead of Player 1's, so the two fronts never match.
- A tap plays the card the player saw in front at the touch: the screen turns a card `SHOW_LAG_MS` = 240 ms after the
  drum steps, so the card is the one in front at `at − SHOW_LAG_MS`. In the team game the touch freezes that card at
  once (`touch`), the roll plays it (`done`), and a failed read lets it go (`fail`).
- Once one seat has played, the other has one turn of its drum (`dwell × cards in hand`); then its front card is
  played for it, with its last roll (the seed's until its badge has rolled).
- Stat: `STATS[(roll1 + roll2) mod 4]`, chosen only after both cards are down. Chosen first, it would hand the round
  to whoever plays second.
- Round: the higher number on that stat takes the round; equal numbers tie and the round is replayed with the next
  cards. Both played cards leave the hands.
- Match: first to `ROUNDS_TO_WIN` = 2. If a hand runs out first, the leader wins; level is a draw (both stakes back).

## The flow

Join → Stake → pre-market while the stakes go in (the opening bell rings when they are confirmed) → deal → pick →
reveal (the dial turns to the stat, the cards turn over, the seals come down) → the next pick, or over → Result.

## The screen

The team screen wears the Slab look: a dark room with each player's colour pooling up from their side, thick
graphite slabs lit from above, chunky Unbounded type, and the seat colours (orange, cyan) as fills and rims. A
Rolodex stands down each side, the cards upright on a drum with an index tab each; between them a tray holds the
stat wheel over two wells, where the played cards land face down and turn over at the reveal, the winner's lifting.
The game draws the top band itself: each player, their USDC stake and round pips, the round and the pot. The built
screen keeps it in a frame: each hand as a column of graphite cards whose front card lifts in the seat's colour, a
white stat chip over the two played cards at the reveal, the score at the top, and a slab naming the winner.

Before the deal, while both stakes go into the pot, a pre-market slab sits over the wells: status lamps for the
transaction (signed, sent, in a block, confirmed), its hash and seconds, and an amber ticker tape of the chain's own numbers (block,
gas, pot). It never shows a stock's numbers. When the stakes are confirmed on chain the opening bell rings, the slab reads
MARKET OPEN and goes, and the deal begins.

The comps it was built to, at the Pi's 1280×800: [the match](look/slab-match.png) and
[the reveal](look/slab-reveal.png).

## Station text

| When | Big | Small |
|---|---|---|
| deal | `DEAL` | `round 1  0 - 0` |
| pick | the front card's ticker | `tap to play` (rolling: `HOLD STILL\|rolling`) |
| played | `PLAYED` | the ticker |
| reveal | the ticker | `PRICE $644.30` |
| over | `WIN` / `LOSE` / `DRAW` | `2 - 1` |

## What a remix may change

- The deck (other stocks, other stats; the modulus is the number of stats), the hand size, the drum speeds.
- Higher wins or lower wins, per stat; first to 1, 2 or 3.
- The theme: the cards, the room, the words.

## What it must keep

- The stat chosen from both badges' rolls, after both cards are down.
- Taps judged at the touch, on the card the player saw.
- An end: hands run out, or a seat reaches the rounds to win.
- No claim of proof: the Box referees which card a tap played.

## Pitfalls

- Never show the numbers during the pick: both hands share one screen.
- A roll takes up to a second on the chip. The team game holds the card from the touch, so a turn never ends under a
  badge that is still rolling. A built game hears of a tap only once its roll is back: a tap whose turn ran out
  meanwhile is too late (its card was played for it). Keep the last turn long (a whole drum turn here).
- A tap that began before the match began must not count in it.
