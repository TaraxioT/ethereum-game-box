# The Game Box UI, with a Demo mode

The plan for the Box's touchscreen, built simulated first. Plan live at
https://plans.georgekm.com/ethereum-game-box-game-ui-2026-11-06/. **Demo live at https://ethereum-game-box.pages.dev/.**

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

- The Box is a small piece of the world computer drawn as a world of light: a core at the centre of a dark grid,
  with the chain's own objects (ports, a block readout, programs) wired into it by lines of light. Inside a game the
  Box steps back and the game has its own look.
- One locked layout for Home: ports in the top corners, the block readout at the top centre, the core in the middle,
  the focused game's title, facts and Play on the left, and a rack of programs along the bottom on the Grid's floor,
  every trace running into the core.
- The look fails in known ways, and these are rules: lit fills look like a website (all brightness comes from thin
  lines); wide or animated glows look cheap and cost frames (glow is static); a spinning logo and a boot that moves
  everything at once look broken; idle programs that glow look busy; cyan for the system would be mistaken for
  Player 2.
- Text is big and set in wide display caps, like a console, with squared caps for labels and mono for every number.
- Stock Duel keeps cards. The hand is a Rolodex with index tabs, so a player always sees their whole hand. The stat
  is picked last, after both cards are down; picking it first hands the round to the second player. No dice, no
  hex-hash visuals, no cards fanned on a table, no tilted cards.

## 3. The look: the Grid

**A near-black world lit only by lines.** All brightness comes from thin emissive lines; surfaces never light up as
flat fills. Cool white-blue light belongs to the system, orange and cyan to the two sides. Geometry is rectilinear:
straight runs, 45° bends and chamfered corners, with circles only for the core and the badge sockets. A reflective
floor grid runs toward the viewer under a single horizon line. No skeuomorphic material is left: no plates, screws,
chips, copper, brass, gunmetal, chains, needles, LCD segments, keycaps, wood or pucks.

| Object | How it looks | When it moves |
|---|---|---|
| **Grid** | The void; a faint 64 px grid on the back wall; one horizon line; a perspective floor vanishing under the core, with the core's soft reflection on it. Every trace from the ports, the block readout and the programs runs into the core as a light line, unpowered at 18 %, ending in a lit terminal bar where it meets a part. | Never. Drawn once per layout and scale and cached. Packets run along its traces as light trails. |
| **Core** | An outer ring of light with four notches, a ring of 24 segments, a thin inner ring round a dark disc, and the real six-facet Ethereum mark in wireframe: near-black facets edged in hot lines. | Holds still. Ignites segment by segment at boot. Swells (a ring grows out and fades, the segments bloom) when a transaction lands or a block seals. Turns once like a coin when a game launches. |
| **Ports** | Top corners. A socket of light in the seat's colour (Player 1 orange, left; Player 2 cyan, right) holding the badge's blockie as a lit LED grid, the name, a mono balance and a seat-colour underline. Empty: a dim socket and `TAP BADGE`. | A badge arriving rezzes the socket and name; changed balance digits flicker in. A tap flashes the socket; a refused tap shakes it with a red flash. |
| **Block readout and gas** | Four corner brackets round `BLOCK` and the head block in mono, `SEPOLIA` under it. Beside it a 16-segment gas bar with a `1.8 GWEI` readout. | Changed block digits flicker in one at a time. Gas segments switch one at a time toward the new value. |
| **Facts** | Small chamfered data tags: a line icon and a word (players, time, stake range). | Rez in 90 ms apart when the focused game changes. |
| **Keys** | Chamfered frames of light. `primary` (Play and every key that moves the game on): the line full with its bloom and a glowing label. `ghost` (Back, Home): a quiet line. `alert` (`REFUND ALL`): primary in red. The chosen stake fills solid with light. | A press flashes the key's shape. `TAP TO START` breathes. |
| **Programs** | The rack's cartridges: chamfered frames round an art window with a faint grid and the game's art in light lines (Quick Draw a bolt, Stock Duel orange and cyan candlesticks), the title under it. Unbuilt games are sealed: the window hatched, a small `SOON` tag. | The focused one lifts on a spring and only then lights its frame and a hot foot bar. |
| **Transaction progress** | A packet runs along the trace from the port to the core (or out to a port for a payout), leaving a trail that fades; the core swells; a strip steps `SIGNED › SENT › IN BLOCK n › PAID`, with the hash, or `SIMULATED`, beside it. | Each step lights (and flickers once) when it happens, at the simulated chain's real pace. |

**Palette.** Void `#010409`, panel fills `#030a12`, deep `#061522`. System light `#cfe8f6` with a white `#ffffff`
core and a `rgb(150 200 230 / 0.42)` bloom. Seats: Player 1 orange `#ff9b3d`, Player 2 cyan `#3fd9ff`, each with its
own bloom. Alert red `#ff2d3d`. Text `#eaf7ff`, `#a9c4d2`, `#6d8796`, `#3e5462`. System light is never cyan: cyan is
Player 2's alone and orange Player 1's. A win is the winner's seat colour, not green; a loss dims to 40 %, not red.
Red means something is wrong (Refund, `CUT POWER`, `NEEDS n EGB`, a refused tap). Money is plain text in mono. No
gold, lavender, violet or mint.

**Light.** A lit line has three layers: a 1 px hot core, a 2 px line in its colour, and a bloom. Glow is static:
box-shadow, text-shadow, stacked SVG strokes, or blur baked once into the cached Grid. No CSS filters, SVG blurs,
blend modes or backdrop filters, and no shadow, stroke width or blur ever animates. A glow reaches at most 24 px.
Chamfered shapes are inline SVG (one polygon stroked four times, split into a line layer and a bloom layer); circles
use box-shadow. Animated light is opacity on a pre-glowed layer. A frame is at 30 % idle, 100 % with its bloom when
active, 12 % disabled, 25 % when nothing is seated.

**Type.** Syncopate (700, wide caps) for display: titles, keys, the Result banner, the Refund head. Oxanium (600,
squared caps) for labels, names, statuses and panels. JetBrains Mono (700, tabular) for every number. All
self-hosted and bundled. Text glow only on display text and lit numbers. Nothing under 14 px at 1280×800. The game
screens keep their own faces (Unbounded, Bricolage Grotesque).

**Motion.** Things **rez** in as a line of light that opens into the object (380 ms, one flicker at the end), and
**derez** back into a line that goes out (300 ms). Every entrance and exit in the launcher is a rez or a derez,
views included. The screen is calm until the story reaches an element. Boot goes one step at a time: the void, the
horizon drawn out under the core, the core igniting, the Grid powering on outward, a packet out along every trace,
then the ports, clock and gas bar rezzing in turn. Attract's only idle motion is `TAP TO START` breathing and a lone
packet along a side trace every 7 s or so. Never more than three flickers a second, and a flicker never dips below
40 %. Only transform and opacity animate. Reduced motion (`prefers-reduced-motion`) shows end states with short
fades: no flicker, no breathing, no packets, no shake.

## 4. Screens

| Screen | What it shows | How you get there and out |
|---|---|---|
| **Attract / boot** | The boot sequence, then the Box idling with a breathing `TAP TO START`. | Load. Any tap, click or key leads to Home. Home falls back here after a minute idle. |
| **Home** | The full machine: ports, block readout and gas bar, core, the focused game's title, facts and Play, the program rack (Quick Draw, Stock Duel, Bet on X sealed, B17 sealed). | Focus a program by touching it or with the arrow keys. Play opens Join, or Stake if both seats are full. |
| **Join** | A seat panel per player: each taps a badge to take a seat. A new badge gets 100 test EGB from the faucet (a transaction). | Both seats full → Stake. Back → Home. |
| **Stake** | Stake choices on light keys (5, 10, 25 EGB), the trust tier, and each seat's `TAP TO SIGN`. Both taps → the Box opens the match (one transaction, both stakes in). | Opened → the game. Back → Home before anyone signs. |
| **Quick Draw** | The game, under the thin Box overlay. | Ends → Result. |
| **Stock Duel** | The game, under the thin Box overlay. | Ends → Result. |
| **Result** | The winner's port lit, `WINNER`, the payout transaction running from the core to their port. A draw returns both stakes. | Rematch (both seats tap again on Stake) or Home. |
| **Refund** | Shown when the Box fails to settle in time: the open match, its timeout counted in blocks, then each seat taps to take its stake back (a transaction each), or `REFUND ALL` sends whatever is still owed (a refund always pays the stake's owner, whoever asks). | In Demo mode, the `CUT POWER` switch in the DEMO tag makes the Box miss its settle during a game. Both refunded → Home. |

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

**Bet on X** and **B17** show on Home as sealed programs with a `SOON` tag and no fake art. They
can be focused (their title and facts show) but Play stays dark.

## 6. Architecture

```
apps/box/
  package.json            @egb/box: dev, dev:box, build, typecheck, test
  vite.config.ts          root src/screen, out dist/screen
  src/
    screen/
      index.html          the one page
      main.ts             picks the link and the mode, mounts the app
      tokens.css          the Grid's palette, type, light and motion tokens, and the ones the games share
      fonts.css           the self-hosted faces
      README.md           every part, documented
      parts/              custom elements: <egb-core> <egb-port> <egb-clock> <egb-gauge> <egb-fact> <egb-key>
                          <egb-cart> <egb-txbar> <egb-panel>; frame.ts (+ test), digits.ts (+ test),
                          gas-level.ts (+ test), blockie.ts (+ test), eth-mark.ts, part.ts, register.ts
      shell/              layout.ts (anchors per orientation), stage.ts, route.ts + traces.ts (geometry),
                          grid.ts (cached canvas), packets.ts, rez.ts (+ test), machine.ts, router.ts, boot.ts,
                          app.ts, sound.ts, dom.ts
      views/              view.ts (the contract), routes.ts, attract.ts, home.ts, rack.ts, join.ts, stake.ts,
                          result.ts, refund.ts, page-layout.ts, seat-panel.ts
      link/               types.ts (BoxLink, BoxState, BoxEvent, ScreenCommand), sim/ (engine, chain, ledger, txs,
                          bot, stations, badges, catalogue, control)
      demo/               keys.ts demo-tag.ts intro.ts demo.css
    games/
      seat.ts game.ts random.ts
      quick-draw/         types.ts, rules.ts (+ test), screen.ts, scene.ts, sign.ts, figure.ts
      stock-duel/         types.ts, rules.ts (+ test), deck.ts, screen.ts, scene.ts, rolodex.ts, dial.ts, reveal.ts,
                          score.ts
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
  simulated behind it: `SimLink.tap(seat)` is how Demo mode's screen taps and the A / L keys tap, and it is not part
  of `BoxLink`. Every simulated transaction has no hash, and the screen shows `SIMULATED` wherever a hash is missing.
- **`LiveLink`**, a WebSocket to the Box server in `src/server/`, comes later and implements the same interface. Not
  built in this pass.

## 7. Demo mode

- **One codebase, one flag**: `VITE_EGB_MODE=demo|box`. `demo` lets the screen stand in for the tap stations and adds
  the DEMO tag. `box` is the bare screen for the Pi's kiosk browser. Until `LiveLink` exists, both run on `SimLink`;
  in `box` mode both seats are people (no bot), and the screen takes no taps: the real stations (and A / L on a
  laptop) are the only way to tap. The screen fills the whole window in both.
- **Taps on the screen** (Demo mode only): touching a player's frame (their port, or their seat panel on a page) taps
  that seat. In a game, a touch on a player's half of the screen below the overlay taps for them, with a ring of
  their light swelling from the touch. **A** taps Player 1 and **L** Player 2, in both modes; in Demo mode the ports
  show their key.
- **Opponent**: `VS BOT` / `HOT SEAT` in the DEMO tag. With the bot, Player 2 is the bot's badge (its port wears a
  `BOT` tag), taps there do nothing, and the bot taps with human timing: a 0.6–2.2 s think in Stock Duel, a
  220–420 ms reaction in Quick Draw with a rare early tap.
- **Labelling**: the **DEMO tag** is always visible in the window's bottom-right corner. Opened, it holds
  `CUT POWER` (for Refund; the tag reads `POWER CUT` with a red lamp while it is on), `OPPONENT` and `SOUND`, all
  usable by keyboard. Simulated transaction progress says `SIMULATED` where a hash would be.
- **A one-time intro** panel rezzes in after the boot: two ways to tap (a player's frame or half of the screen, or
  A / L), and where the opponent switch and the power cut are. OK or Escape dismisses it for good (localStorage
  `gamebox-intro=2`, so visitors who saw the old intro see the new taps once).
- **Sound**: small synthesized cues with a dark analogue-synth feel for the launcher (boot, tap, block, error, win,
  lose; the games' seal, flip and tick unchanged), muted from the DEMO tag. localStorage `gamebox-muted=1` mutes.

## 8. Constraints

- **60 fps** on a Raspberry Pi 5 browser at 1280×800; scales to 1920×1080 and to a 390×844 phone (a portrait layout
  of the same objects). Checked so far on a laptop browser (no dropped frames on Home); the Pi run comes with the
  hardware.
- The static Grid is drawn once per layout and scale and cached; packets draw on a separate canvas only while one is
  running. Never more than about 12 layers animate at once.
- Only transform and opacity animate. Glow is static and reaches at most 24 px: no CSS filters, SVG blurs, blend
  modes, backdrop filters or animated shadows.
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
9. **The Grid.** The launcher restyled as light: tokens and faces, rez and derez, the Grid and light-trail packets,
   the core, ports, clock and gas bar, chamfered keys, facts, programs, panels and the strip, the pages, the boot,
   attract and Home in sequence, screen taps and the DEMO tag in place of the desk, the retuned cues.

## 10. Done when

- [x] Every §3 object is visible on Home: Grid, core, ports, block readout and gas bar, facts, keys, programs,
      transaction progress.
- [x] Quick Draw plays end to end against the bot and hot-seat.
- [x] Stock Duel plays end to end against the bot and hot-seat.
- [x] Refund is reachable and pays both stakes back.
- [x] The DEMO tag and `SIMULATED` labels show.
- [x] All three input paths work: touch a frame, touch a half in a game, A / L.
- [x] Reduced motion shows end states; mute works and `gamebox-muted=1` mutes.
- [x] 1280×800, 1920×1080 and 390×844 all work.
- [x] `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [x] The demo is live at a public URL: https://ethereum-game-box.pages.dev/.
- [x] The Grid look on every launcher screen (boot, attract, Home, Join, Stake, Result, Refund, the in-game overlay)
      is deployed to the demo.
- [ ] 60 fps on the Pi 5 at 1280×800 (checked so far in a laptop browser at 4× CPU throttling).
