# The Game Box UI, with a Demo mode

The plan for the Box's touchscreen, built simulated first. Live at
https://plans.georgekm.com/ethereum-game-box-game-ui-2026-11-06/.

## 1. Goal

The Box's touchscreen UI, plus a **Demo mode** of the same UI that runs in any browser with no hardware. The
hackathon requires a live deployment, and Demo mode is it: anyone with the link can tap a badge, stake and play a
match against a bot or a friend, and watch the simulated chain settle it.

This pass is UI only and fully simulated: no contracts, no relayer, no Box server, no chain reads, no hardware
drivers. The screens talk to one interface, `BoxLink`, so the real Box plugs in behind it later without a screen
changing.

## 2. What exists today

**The repo is greenfield.** It has the pnpm workspace (`apps/*`, `packages/*`), `tsconfig.base.json`, the root
scripts that run `typecheck`, `test` and `build` across packages, `CLAUDE.md`, a README per folder, and the project
plan. No package has a `package.json` yet, so `pnpm typecheck` runs nothing. `deployments/sepolia.json` has no
contracts. There is no screen, no game code and no test.

**This pass adds** `@egb/box` with its screen (`apps/box/src/screen/`) and two games' rules and screens
(`apps/box/src/games/`), a simulated Box behind `BoxLink`, the Demo mode build, its tests, and a public deployment on
Cloudflare Pages. Nothing outside `apps/box/` changes except this plan and the lockfile.

**The design language it continues**, as plain facts:

- The Box is drawn as a small piece of the world computer: a machine on a circuit board, with the chain's own
  objects (a core, ports, a block clock, cartridges) as physical parts. Inside a game the Box steps back and the
  game has its own look.
- One locked visual target for Home: ports in the top corners, the clock hanging at the top centre, a black glass
  sphere in the middle, the focused game's title, facts and a gold Play on the left, and a rack of keycap
  cartridges along the bottom, all on gunmetal plates with neon traces running into the core.
- Earlier attempts failed in known ways, and these are now rules: flat mid-tone boards kill the 3D (brightness must
  come from light); wide blooms look cheap (glows stay on their edges); a spinning logo and a boot that moves
  everything at once look broken; idle cartridges with neon look busy; saturated yellow keys look like a website.
- Text is big and set in a display face in caps, like a console, never tiny letter-spaced labels.
- Stock Duel keeps cards. The hand is a Rolodex with index tabs, so a player always sees their whole hand. The stat
  is picked last, after both cards are down; picking it first hands the round to the second player. No dice, no
  hex-hash visuals, no cards fanned on a table, no tilted cards.

## 3. The look

**World Computer, skeuomorphic.** The Box is drawn as a machine built from real objects with thickness and edges.
Nothing reads as a flat web panel. One key light from the top left: lit top edges, dark bottom edges, inner shadows.

| Object | How it looks | When it moves |
|---|---|---|
| **Board** | Gunmetal plates with seams, screws and small 3D parts (chips, capacitors, pads). Thick neon traces, each ending in a connector, run from the ports, clock and cartridges into the core. | Never. Drawn once and cached. Packets ride its copper. |
| **Core** | A black glass sphere in a thick metal collar on a thin base ring. The real six-facet Ethereum mark inside, front on, lit from behind. A window reflection, a specular point, a Fresnel rim. | Holds still. Swells when a transaction lands or a block seals. Turns once like a coin when a game loads. |
| **Ports** | Top corners. A neon ring socket (Player 1 orange, left; Player 2 cyan, right), a blockie tile, the player's name, and an amber seven-segment balance LCD. Empty: a dark socket and `TAP BADGE`. | Lights when its badge taps; the balance digits roll on a payout. |
| **Chain clock and gas gauge** | A bevelled LCD hanging from the top centre on two short chains: `BLOCK n`. Beside it an analogue gauge with a needle and a gwei readout. | The number rolls one digit at a time on each block. The needle eases to each new gas value. |
| **Facts** | Small IC chip packages with pins on two sides: players, time, stake range. | Press in one after another when the focused game changes. |
| **Keys** | Play and every primary key are brass: a bevelled gold frame round a brushed warmer face, engraved letters, a bronze edge under it, real travel. Secondary keys are gunmetal. | Travel down on press. `TAP TO START` breathes. |
| **Cartridges** | Gunmetal keycaps with a dark glass screen, an arcade-caps title across its top and the game's art standing on the glass, set in clipped housings. Idle: no neon. Unbuilt games are sealed with an engraved `SOON` plate and no screen. | The focused one rises out of its housing and only then lights a thin lavender strip at its foot. |
| **Transaction progress** | A packet of light runs along the copper from the port to the core (or from the core to a port for a payout); the core seals it; an LCD strip steps `SIGNED → SENT → IN BLOCK n → PAID`, with the hash, or `SIMULATED`, beside it. | Each step lights when it happens, at the simulated chain's real pace. |

**Palette.** Devcon 8's night with the lights dimmed. Room `#120c24`; plates `#2d2356 → #211943`; deep grooves
`#120c24`; ink `#07040f`, `#0e0820`, `#160b2b`. Neon: lavender-violet `#ad8fff`, marigold `#ffc46b`, mint `#86eec4`.
Devcon hues for accents: violet `#7235ed`, lavender `#c4aaf7`, ETH `#8c8dfc`. Seats: Player 1 orange `#ff9b3d`,
Player 2 cyan `#3fd9ff`. Text `#f5f1ff`, `#d2c9ef`, `#9d92c4`. LCD amber `#ffb547` on `#1a0f04`; clock mint on
dark teal. Money is gold, wins green `#7ee08a`, losses red `#ff6b6b`.

**Light.** Every glow is a 1–3 px line with a short glow, at most 10 px. No light spills onto the board. Brightness
comes from light (lit edges, the core's centre, neon), never from a flat mid-tone board. Static box-shadows and
gradients only: no blur filters, no blend modes, no animated shadows.

**Type.** Unbounded for display (titles, keys, labels: caps, big, a console not a website), Bricolage Grotesque for
body text, JetBrains Mono for numbers. All three self-hosted, bundled with the build. Nothing under 14 px at
1280×800.

**Motion.** Physical and story-driven: the screen is calm until the story reaches an element, then that element
comes alive. Boot goes one step at a time: the core lights where it stands, the board powers on round it, the ports
and clock come up, the cartridges rise, then `TAP TO START` breathes. Page changes are depth moves (the old page
sinks, the new one rises). Only transform and opacity animate. Reduced motion (`prefers-reduced-motion`) shows end
states with short fades.

## 4. Screens

| Screen | What it shows | How you get there and out |
|---|---|---|
| **Attract / boot** | The boot sequence, then the Box idling with a breathing brass `TAP TO START`. | Load. Any tap, click or key leads to Home. Home falls back here after a minute idle. |
| **Home** | The comp: ports, clock and gauge, core, the focused game's title, facts and Play, the cartridge rack (Quick Draw, Stock Duel, Bet on X sealed, B17 sealed). | Focus a cartridge by touching it or with the arrow keys. Play opens Join, or Stake if both seats are full. |
| **Join** | Two big sockets: each player taps a badge to take a seat. A new badge gets 100 test EGB from the faucet (a transaction). | Both seats full → Stake. Back → Home. |
| **Stake** | Stake choices on brass keys (5, 10, 25 EGB), the trust tier, and each seat's `TAP TO SIGN`. Both taps → the Box opens the match (one transaction, both stakes in). | Opened → the game. Back → Home before anyone signs. |
| **Quick Draw** | The game, under the thin Box overlay. | Ends → Result. |
| **Stock Duel** | The game, under the thin Box overlay. | Ends → Result. |
| **Result** | The winner's port lit, `WINNER`, the payout transaction running from the core to their port. A draw returns both stakes. | Rematch (both seats tap again on Stake) or Home. |
| **Refund** | Shown when the Box fails to settle in time: the open match, its timeout counted in blocks, then each seat taps to take its stake back (a transaction each). | In Demo mode, the `CUT POWER` switch on the DEMO plate makes the Box miss its settle during a game. Both refunded → Home. |

## 5. Games inside the Box

Inside a game the Box shrinks to a **thin overlay**: the two ports in the top corners (smaller), the clock at the top
centre, and the stake between them. Everything else of the Box steps back; the game has its own design language.

### Quick Draw

A western standoff at dusk, drawn in flat silhouette: a long horizon, two seat-coloured figures at the edges, a wooden
**flip-plate sign** in the middle on a post.

- **Wait**: the sign reads `WAIT…`, the light dims, a heartbeat thuds. The draw comes after a random 2–6 s, from a
  seed both players can't see.
- **Draw**: the sign's plate flips to `DRAW`. First tap wins.
- **Early tap**: a tap before the flip loses on the spot (`TOO EARLY`).
- The result shows each player's reaction time in milliseconds.

### Stock Duel

A painterly **live painting**: a dark study, a warm lamp on Player 1's side (left), a cyan lamp on Player 2's
(right), each pooling light on its player's half of the desk. Brushed-paper textures from layered gradients.

- **The deal.** Each player gets four stocks from a 20-stock deck, with numbers recorded from Robinhood Chain's stock
  pools, frozen at the deal.
- **The hand** is a classic brass-and-card **Rolodex** with index tabs: all four tickers show on the tabs; the front
  card is face up with the company's name and a draining ring that shows how long it stays in front. Where the stats
  go there is a `?`. No stats on hand cards before the flip. Cards stay upright: the drum indexes one card at a time,
  turning cards over its top, never tilted on the page.
- **The pick.** A tap plays the front card. Once one player has played, the other has one turn of the drum, then their
  front card is played for them.
- **The stat** is chosen last, after both picks, on a brass **astrolabe dial**: price, average price, 24-hour move or
  liquidity. It comes from both badges' randomness: `(roll1 + roll2) mod 4`.
- **The flip.** Both cards come out as cream manuscript reveal cards and flip together. The higher number wins; the
  winner's card gets a green wax seal stamped `FINALIZED`, the loser's a red one stamped `SLASHED`. A tie replays the
  round with the next cards.
- **Best of three.** First to two rounds. If the hands run out, the leader wins; level is a draw.

**Bet on X** and **B17** show on Home as sealed cartridges with an engraved `SOON` plate and no fake screens. They
can be focused (their title and facts show) but Play stays dark.

## 6. Architecture

```
apps/box/
  package.json            @egb/box: dev, build, typecheck, test
  vite.config.ts          root src/screen, out dist/screen
  src/
    screen/
      index.html          the one page
      main.ts             picks the link and the mode, mounts the app
      tokens.css          palette, type, light, motion tokens
      fonts.css           the three self-hosted faces
      README.md           every part, documented
      parts/              custom elements: <egb-core> <egb-port> <egb-clock> <egb-gauge> <egb-fact>
                          <egb-key> <egb-cart> <egb-txbar> <egb-lcd>, blockie.ts, eth-mark.ts
      shell/              board.ts (cached canvas), layout.ts (anchors per orientation), packets.ts,
                          stage.ts (scale to fit), boot.ts, router.ts (depth moves), overlay.ts, sound.ts
      views/              attract.ts home.ts join.ts stake.ts result.ts refund.ts, view.ts (the contract)
      link/               types.ts (BoxLink, BoxState, BoxEvent, ScreenCommand), sim/ (the engine)
      demo/               frame.ts pucks.ts oled.ts badges.ts bot.ts plate.ts intro.ts
    games/
      quick-draw/         rules.ts (+ test), screen.ts
      stock-duel/         rules.ts (+ test), deck.ts, rolodex.ts, dial.ts, reveal.ts, screen.ts
```

- `apps/box/src/screen/` is Vite + TypeScript with small custom elements and no UI framework.
- Every game's `rules.ts` is pure, `(state, event) → state`, with no clock or randomness of its own (time and seeds
  arrive in events), and is unit tested.
- **The screen talks only to `BoxLink`:**

```ts
interface BoxLink {
  state(): BoxState;                                       // the whole Box, as the screen draws it
  subscribe(fn: (state: BoxState, event: BoxEvent) => void): () => void;
  send(command: ScreenCommand): void;                      // what a touch on the screen asks for
}
```

  `BoxState` holds the phase, both seats (badge, name, balance), the chain (block, gas), the focused game, the open
  match with its game state, transactions in flight, and what each tap station's OLED shows. `BoxEvent` names the
  moment that changed it (a block, a tap, a transaction step, a buzz, a sound cue), so the screen can animate the
  moment rather than diff states. `ScreenCommand` is the touchscreen's vocabulary: focus, play, choose a stake, back,
  rematch, home, set the opponent.
- **`SimLink`** is this pass's Box: a simulated Box in the browser. It runs the game rules, a fake ledger (EGB
  balances, a faucet, escrow), a block clock at Sepolia's pace (a block every 12 s, numbered from Sepolia's real
  height), a gas value that wanders between 0.8 and 4 gwei, the stock deck with recorded prices, and transactions
  with realistic timing (signed at once, sent ~0.4 s later, in the next block, paid ~1 s after it). Tap stations are
  simulated behind it: `SimLink.station(seat).tap(badge)` is how the drawn hardware taps, and it is not part of
  `BoxLink`. Every simulated transaction has no hash, and the screen shows `SIMULATED` wherever a hash is missing.
- **`LiveLink`**, a WebSocket to the Box server in `src/server/`, comes later and implements the same interface. Not
  built in this pass.

## 7. Demo mode

- **One codebase, one flag**: `VITE_EGB_MODE=demo|box`. `demo` adds the drawn hardware, badges and labels. `box` is
  the bare screen for the Pi's kiosk browser. Until `LiveLink` exists, both run on `SimLink`, and in `box` mode the
  keyboard taps (A / L) stand in for the stations.
- **The missing hardware is drawn**: two tap-station pucks at the bottom corners of the window, each a dark puck with
  a seat-colour NFC ring, a 128×64 monochrome OLED showing what the real station would show (`TAP TO JOIN`,
  `SIGN 10 EGB`, `GO!`, the card in front), and a shake for the buzz motor. The Box screen scales down to leave the
  desk below it.
- **Badges are draggable cards** on the desk between the pucks. Tap four ways: drag a badge onto a puck; click or
  touch a puck (it taps with that seat's badge); press **A** (Player 1) or **L** (Player 2).
- **Opponent**: a `VS BOT` / `HOT SEAT` switch on the desk. With the bot, Player 2 is the bot's badge and taps with
  human timing: a 0.6–2.2 s think in Stock Duel, a 220–420 ms reaction in Quick Draw with a rare early tap.
- **Labelling**: an engraved `DEMO` plate is always visible, with the `CUT POWER` switch for Refund. Simulated
  transaction progress says `SIMULATED` where a hash would be.
- **A one-time brass instruction plate** explains the four ways to tap, then stays dismissed (localStorage
  `gamebox-intro=1`).
- **Sound**: small synthesized cues (tap, block, seal, flip, win) with a mute key on the desk. localStorage
  `gamebox-muted=1` mutes.

## 8. Constraints

- **60 fps** on a Raspberry Pi 5 browser at 1280×800; scales to 1920×1080 and to a 390×844 phone (a portrait layout
  of the same objects).
- The static board is drawn once per layout and cached; packets draw on a separate canvas only while one is running.
- Only transform and opacity animate. No blur filters, blend modes or animated shadows.
- Small typed modules with one job each. Every part documented in `apps/box/src/screen/README.md`.
- Tests: every game's rules, the simulated ledger, clock and transaction timing, the bot's timing bounds, blockies,
  and the layout's anchors.
- `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## 9. Steps

1. **Scaffold.** `@egb/box` with Vite, Vitest and TypeScript, the scripts, an empty page.
2. **Tokens and parts.** `tokens.css`, self-hosted fonts, the custom elements and their README, the shared types
   (`BoxState`, `BoxEvent`, `ScreenCommand`, game states, the view contract).
3. **Home and boot.** The cached board, layout, stage scaling, router, attract, boot and Home.
4. **Rules with tests.** Quick Draw and Stock Duel rules, the deck, their tests.
5. **SimLink and Demo mode.** The engine (ledger, clock, gas, transactions), the bot, the pucks, badges, DEMO
   plate, instruction plate, sound.
6. **Join, Stake, Quick Draw, Result and Refund.** The flow end to end.
7. **Stock Duel.** Rolodex, astrolabe dial, reveal cards, wax seals.
8. **Deploy.** The demo build on Cloudflare Pages, this plan ticked, republished.

## 10. Done when

- [ ] Every §3 object is visible on Home: board, core, ports, chain clock and gas gauge, facts, keys, cartridges,
      transaction progress.
- [ ] Quick Draw plays end to end against the bot and hot-seat.
- [ ] Stock Duel plays end to end against the bot and hot-seat.
- [ ] Refund is reachable and pays both stakes back.
- [ ] The `DEMO` plate and `SIMULATED` labels show.
- [ ] All four input paths work on the pucks: drag, click, touch, A / L.
- [ ] Reduced motion shows end states; mute works and `gamebox-muted=1` mutes.
- [ ] 1280×800, 1920×1080 and 390×844 all work.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [ ] The demo is live at a public URL.
