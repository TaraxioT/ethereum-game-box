# Prompt: give the Box's launcher the Grid look

Paste everything below the line into a fresh Claude Code session on the `game-ui` branch.

---

You are restyling the Ethereum Game Box screen (`apps/box/src/screen/`). Read `CLAUDE.md`,
`apps/box/src/screen/README.md` and `plan/game-ui.md` first. The current UI works end to end and its structure is
good. Keep the structure and change two things:

1. **Remove the fake hardware.** Remove the skeuomorphic materials drawn on the Box screen: the circuit board,
   gunmetal plates, screws, chips, capacitors, copper, brass and gunmetal keys, hanging chains, the analogue gauge,
   seven-segment LCDs, IC-chip facts and keycap cartridges. Also delete the Demo desk under the screen: the walnut
   bench, the tap-station pucks, their OLEDs and the draggable badge cards.
2. **Give the launcher an art direction inspired by the film *Tron: Legacy* (2010).** It covers the boot, attract,
   Home, Join, Stake, Result and Refund, the in-game overlay, every transition between them, and the Demo controls.
   It does not cover the two game screens (Quick Draw, Stock Duel), which keep their own looks untouched.

Every design decision is below. Where this prompt and `plan/game-ui.md` §3 disagree, this prompt wins, and you
rewrite §3 to match (see "Docs and plan").

## What the film's look means here

Use the film as art direction only. Use no trademark, logo, wordmark, the film's font, character, vehicle, identity
disc, music or sound. Nothing on screen names the film. In practice the look is:

- A near-black, glossy world. **All brightness comes from thin emissive lines.** Surfaces never light up as flat
  fills.
- Cool white-blue light for the system. Orange and cyan for the two sides (Player 1 and Player 2 already use them).
- Rectilinear geometry: straight runs, 45° bends, chamfered corners. Circles only for the core and the badge sockets.
- A reflective floor grid in perspective under a single horizon line.
- Things **rez** in as a line of light that opens into the object, and **derez** back into a line that goes out.
  This is the signature motion and replaces every other entrance and exit in the launcher.
- Wide, geometric capitals for display. Clean squared sans for labels. Monospace for every number.

## Scope

**Changes:** `apps/box/src/screen/` (tokens, fonts, parts, shell, views, demo, main), `apps/box/package.json` (two
font packages), `apps/box/src/screen/README.md`, `plan/game-ui.md` and `plan/game-ui.html`.

**Does not change:**

- `apps/box/src/games/**`, the two game screens and their CSS.
- `link/types.ts` (`BoxLink`, `BoxState`, `BoxEvent`, `ScreenCommand`, `StationView`), the simulated Box (`link/sim/*`)
  apart from one rename (below), and its tests.
- `route.ts` and `traces.ts`: the geometry and the named traces stay, along with their tests. Only how traces are
  drawn changes.
- `stage.ts`, the stage sizes (1280×800 landscape, 720×1080 portrait), `router.ts`'s logic (keys, overtaking moves,
  never mounting a stale view), `routes.ts`, the poses (`home`, `page`, `game`), the view contract (`view.ts`), and
  every view's behaviour and wording unless this prompt changes it.
- `plan/oled.svg`: the plan's README uses it to show the real station's screen.

**Shared tokens the games use stay exactly as they are:** `--display`, `--body`, `--mono`, `--p1`, `--p1-hi`, `--p2`,
`--p2-hi`, `--ease-out`, every `--brass*`, and the Unbounded, Bricolage Grotesque and JetBrains Mono font imports.
Before deleting any other token, grep `apps/box/src` to confirm nothing still uses it.

## Tokens (`tokens.css`)

Add a Grid block. Remove the launcher-only tokens it replaces (`--room`, `--ink-*`, `--plate-*`, `--groove`,
`--metal*`, `--neon-*`, `--violet`, `--lavender`, `--eth`, `--pink`, `--lcd-*`, `--gold`, `--win`, `--lose`,
`--lit-edge`, `--plate-shadow`, `--well`) once nothing uses them.

| Token | Value | Use |
|---|---|---|
| `--void` | `#010409` | Page and stage background, the room round the stage |
| `--void-2` | `#030a12` | Panel and key fills |
| `--deep` | `#061522` | Floor near the horizon, the core's inner disc centre |
| `--sys` | `#cfe8f6` | System light: lines, outlines, the core |
| `--sys-hot` | `#ffffff` | The hot core of every lit line, the rez line |
| `--sys-bloom` | `rgb(150 200 230 / 0.42)` | The bloom round system light |
| `--p1`, `--p2` | unchanged (`#ff9b3d`, `#3fd9ff`) | The two sides |
| `--p1-bloom` | `rgb(255 155 61 / 0.45)` | Player 1 bloom |
| `--p2-bloom` | `rgb(63 217 255 / 0.45)` | Player 2 bloom |
| `--alert` | `#ff2d3d` | Errors, Refund, CUT POWER, `NEEDS n EGB`, a refused tap |
| `--fg` | `#eaf7ff` | Primary text |
| `--fg-2` | `#a9c4d2` | Secondary text |
| `--fg-3` | `#6d8796` | Labels |
| `--fg-4` | `#3e5462` | Empty and disabled |
| `--hud-display` | `"Syncopate", system-ui, sans-serif` | Titles, keys, banners |
| `--hud-body` | `"Oxanium Variable", system-ui, sans-serif` | Labels, status lines, panel text |
| `--ease-rez` | `cubic-bezier(0.16, 1, 0.3, 1)` | Rez |
| `--ease-derez` | `cubic-bezier(0.7, 0, 0.84, 0)` | Derez |
| `--t-rez` | `380ms` | One rez |
| `--t-derez` | `220ms` | One derez |
| `--t-flicker` | `90ms` | One flicker |

Keep `--ease-spring`, `--ease-in`, `--t-press` (90 ms), `--t-move` and `--t-page`. `html, body` take
`background: var(--void)`.

**Colour rules.** System light is `--sys`, never cyan. Cyan is Player 2's alone and orange is Player 1's alone. A win
is the winner's seat colour, not green. A loss dims to 40 % opacity, not red. Red (`--alert`) means something is
wrong. Money is plain `--fg` in mono. No gold, lavender, violet or mint anywhere in the launcher.

## Type (`fonts.css`, `package.json`)

- Add `@fontsource/syncopate@5.3.0` (import the 700 weight only) and `@fontsource-variable/oxanium@5.3.0`. Pin the
  exact versions, as the other font packages are pinned. Self-hosted and bundled, so the Box needs no network.
- **Display** (`--hud-display`, Syncopate 700, caps, `letter-spacing: 0.02em`): the Home and attract titles, keys,
  the Result banner and the Refund head.
- **Labels** (`--hud-body`, Oxanium 600, caps, `letter-spacing: 0.08em`; kickers use `0.32em`): names, statuses,
  facts, panels, the transaction strip's words.
- **Numbers** (`--mono`, JetBrains Mono 700, `font-variant-numeric: tabular-nums`): block, balances, gwei, stakes in
  the overlay, hashes, reaction times on Result, Refund's countdown.
- Nothing under 14 px at 1280×800. Syncopate is very wide, so titles keep using `fitFont` to fit their column.
- Text glow is a static `text-shadow`: `0 0 4px <colour at 0.9>, 0 0 14px <colour at 0.4>`. Use it only on display
  text and lit numbers, never on body labels.

## Light: how glow is made

Glow is the look, and the Pi 5 has to hold 60 fps. These rules replace the old "glows at most 10 px" rule:

- **Static glow only.** Glow comes from box-shadow, text-shadow, stacked SVG strokes, or `shadowBlur` baked once into
  the cached grid canvas. No CSS `filter`, no SVG `feGaussianBlur`, no `mix-blend-mode`, no `backdrop-filter`. No
  shadow, stroke width or blur ever animates. A glow reaches at most 24 px.
- **A lit line has three layers:** a 1 px `--sys-hot` core, a 2 px line in its colour, and a bloom.
- **Chamfered shapes cannot use box-shadow**, because `clip-path` clips it. Draw them as inline SVG: a polygon
  stroked four times (10 px at 0.08 alpha, 5 px at 0.18, 2 px at 1, 1 px `--sys-hot` at 1). Write this once as
  `parts/frame.ts`: `frameSvg({ w, h, chamfer, corners, tone })` returns **two** `<svg>` elements, `.frame-line`
  (the 2 px and 1 px strokes) and `.frame-bloom` (the 10 px and 5 px strokes). Every chamfered part uses it.
- **Animated light is opacity on a pre-glowed layer:** the `.frame-bloom` element, a duplicate ring, or a lit copy of
  a glyph. Set `will-change: opacity` only while it animates.
- **Circles** (the core's rings, the badge sockets) use `border-radius` with box-shadow bloom. They need no SVG.
- **Chamfer sizes:** keys 14 px, facts 8 px, panels 12 px, cartridges 16 px. Cut the top-left and bottom-right
  corners, except cartridges, which cut top-right and bottom-left. The two uncut corners of a panel carry a 10 px
  `--sys-hot` corner tick.
- **Brightness levels** for a frame line: idle 30 %, active 100 % with its bloom showing, disabled 12 %, empty
  (nothing seated) 25 %.

## Rez and derez (`shell/rez.ts`)

A new module with one job: `rez(node, { delay? }): Promise<void>` and `derez(node): Promise<void>`. They animate only
transform and opacity, using `play()` from `dom.ts`.

- **Rez** (380 ms in all):
  1. 0–120 ms: a temporary `.rez-line` child (2 px tall, full width, `--sys-hot` with `--sys-bloom` box-shadow,
     centred vertically) goes from `scaleX(0)` to `scaleX(1)` from the centre.
  2. 120–380 ms: the node goes from `scaleY(0.02)`/opacity 0 to `none`/opacity 1 on `--ease-rez`, while the line
     fades out.
  3. One flicker after that: opacity 1 → 0.55 → 1 over 90 ms. Then the line is removed.
- **Derez** (300 ms in all): the node goes to `scaleY(0.02)` on `--ease-derez` over 220 ms, leaving a `.rez-line` that
  goes to `scaleX(0)` and opacity 0 over 80 ms.
- **Flicker safety:** never more than three flickers a second on screen, and a flicker never dips below 0.4 opacity.
- **Reduced motion:** both become the existing 160 ms fade to the end state, with no line and no flicker.
- `rez.ts` gets a unit test for its keyframes and timings (pure helpers that return the keyframe arrays).

## The Grid (`shell/board.ts` → `shell/grid.ts`)

Rename the module and its export (`drawBoard` → `drawGrid`). It is still drawn once per layout and scale, DPR-aware,
and cached. Delete everything about plates, seams, screws, chips, copper, pads and connectors. Keep `bend()` and
`pastel()` only if something still uses them.

The canvas draws, back to front:

1. **Void:** a vertical gradient, `--void` at the top to `#020910` at the horizon.
2. **Back wall:** a square grid with a 64 px pitch, 1 px `--sys` lines at 5 % alpha, fading to 0 over the top third of
   the stage.
3. **Horizon:** a 1 px `--sys` line across the full width, baked with `shadowBlur` 20 in `--sys-bloom`. It sits at
   y = 540 in landscape and y = 840 in portrait. Put this value in `layout.ts` as `horizon`.
4. **Floor:** a perspective grid below the horizon, vanishing at (`core.centre.x`, `horizon`). There are 17
   converging lines spread evenly along the bottom edge, plus horizontal lines whose spacing grows geometrically
   (×1.35) toward the viewer. They are 1 px `--sys`, at 10 % alpha near the horizon rising to 22 % at the bottom edge.
   The floor fill goes from `--deep` at the horizon to `--void` at the bottom.
5. **The core's reflection:** a vertical ellipse of `--sys` at 6 % alpha on the floor directly under the core, 2 × the
   core radius wide and 120 px tall, with soft edges (a radial gradient, not blur).
6. **Traces:** every named trace from `tracesFor(layout)` (`port0`, `port1`, `clock`, `slot0`–`slot3`) and the side
   bundles, along the same routes. Each is a light line: a 2 px line in its colour (`port0` `--p1`, `port1` `--p2`,
   everything else `--sys`) with a 1 px hot core, baked `shadowBlur` 8. **Unpowered**, they are drawn at 18 %
   intensity. A trace ends where it meets a part in a 2 × 8 px lit terminal bar across its end, not a connector. Side
   bundles keep their bus pitch and look like parallel light trails.
7. Nothing else: no ornaments, no scattered parts.

`board-dimmer` becomes `grid-dimmer`, with `--void` at 0.7 opacity in the `page` pose. In the `game` pose the grid and
core fade out as they do now.

## Packets as light trails (`shell/packets.ts`)

Same API (`run`, `light`, `resize`), the same canvas only drawing while something is in flight, and the same speeds.

- **A packet** is a head (a 14 × 3 px rounded rectangle in `--sys-hot`, oriented along the trace, with a 10 px bloom in
  the packet's colour) and a **trail**. The path the head has passed stays lit in the packet's colour at full strength
  and fades to 0 over 500 ms behind it, drawn as short segments whose alpha follows their age. A packet is done when
  its trail has faded, not when its head arrives. Its promise still resolves when the head arrives, so the core
  swells on time.
- **Colours:** a port packet is its seat colour (`--p1`/`--p2`, replacing `--p1-hi`/`--p2-hi`). A slot feed and the
  clock trace are `--sys`.
- **`light(trace)`** (the focused cartridge's feed) redraws that trace at full intensity with its bloom over the
  unpowered one. It is static and only redrawn when the focus changes.
- **Attract ambience:** only in attract, a single `--sys` packet runs along one random side-bundle line every
  7 s ± 2 s. It stops the moment attract unmounts or a transition starts. This is the launcher's only idle motion
  besides `TAP TO START` breathing.

## Parts

Keep the custom-element architecture: `part.ts`, shadow roots, filling their box, and reduced motion showing end
states. Keep these element names, because their role stays the same: `egb-core`, `egb-port`, `egb-clock`,
`egb-gauge`, `egb-fact`, `egb-key`, `egb-cart`, `egb-txbar`. Rename `egb-plate` to `egb-panel`, because it is no
longer a screwed-on plate. Delete `egb-seg` (`parts/seg.ts`), because nothing uses seven-segment digits any more.
Update `register.ts`.

### `<egb-core>`: the core

It keeps `glass` and `collar` (radii in px), `dark`, `swell()`, `coin()` and `ignite()`, at the same layout radii.

- **Outer ring** at r = `collar`: a 2 px `--sys` line with a hot core and box-shadow bloom (0 0 6 px and 0 0 18 px).
  Four 10 px notches point outward at 0°, 90°, 180° and 270°.
- **Segment ring** at r = `collar − 14`, 6 px thick: 24 arc segments of 10° with 5° gaps, `--sys` at 70 %. Each
  segment is its own element, so it can light on its own.
- **Inner ring** at r = `glass`: 1 px `--sys` at 50 %.
- **Inner disc:** a radial gradient from `--deep` at the centre to `--void` at the edge. No glass, reflection, specular
  point or Fresnel rim.
- **The Ethereum mark** (`parts/eth-mark.ts`, rewritten as wireframe): the real six-facet geometry, front on, 0.95 ×
  `glass` tall. Facet fills are near-black (the left facets `#0d2433`, the right `#071a26`, the chevron one step
  darker). Every facet edge is a 1.5 px `--sys-hot` stroke with a static outer stroke in `--sys-bloom` 4 px wide.
  There is no backlight. Drop the `backlight` option.
- **Idle:** everything holds still. Nothing rotates.
- **`dark`:** every segment and ring sits at 8 %, and the mark is hidden.
- **`ignite()`** (~800 ms): the segments light clockwise from 12 o'clock, 20 ms apart, then the outer and inner rings
  come up (150 ms), then the mark fades up (300 ms).
- **`swell()`** (700 ms): a duplicate of the outer ring scales 1 → 1.18 while its opacity goes 0.9 → 0, and the segment
  ring's bloom layer goes 0 → 1 → 0. It fires when a transaction lands or a block seals, as now.
- **`coin()`** (900 ms): the mark turns once on Y, as now. Home no longer calls it on a focus change, only on Play
  (see Home).

### `<egb-port seat>`: a player's node

It keeps `seat`, `compact` (70 % from its top outer corner), `set(seat)` and `pulse()`, and adds `refuse()`. It is
designed at 380 × 96, with the socket's centre at the existing ring anchor (52 px in from its outer side, halfway
down).

- **Socket:** a circle of radius 30 px with a 2 px seat-colour line (25 % when empty, 100 % with bloom when seated).
  Inside it sits the badge's blockie as a lit 8 × 8 LED grid, 40 px square, from `blockieLedSvg` in the seat colour.
- **Name:** Oxanium 600 24 px `--fg`, reading away from the socket (rightwards for seat 0, leftwards for seat 1).
- **Balance:** under the name, JetBrains Mono 700 22 px `--fg` followed by ` EGB` in Oxanium 600 14 px `--fg-3`.
- **Underline:** a 1 px seat-colour line runs from the socket along under the name and balance, ending in a 6 px
  tick.
- **Empty:** the socket is at 25 %, the name slot reads `TAP BADGE` in Oxanium 600 20 px `--fg-4`, and there is no
  balance.
- **Demo mode** (attribute `key="A"` / `key="L"`, set by the app in demo only): a 20 × 20 outlined key hint with the
  letter in mono 14 px sits at the module's inner bottom corner, and hover raises the socket line to 100 %.
- **Motion:**
  - A badge arriving rezzes the socket and the name, followed by one flicker.
  - When the balance changes, each changed digit flickers in (opacity 0 → 1 with one dip to 0.5), left to right,
    60 ms apart. This replaces the seven-segment roll.
  - Leaving derezzes the name and drops the socket to 25 %.
  - `pulse()`: the socket's bloom layer flashes 0 → 1 → 0 over 260 ms.
  - `refuse()`: the module shakes (translateX 0, −5, 5, −3, 3, 0 over 220 ms) and the socket flashes `--alert` once.
    The machine calls it on a `tap` event with `accepted: false`, and on `buzz` when that seat has nothing to accept.

### `<egb-clock>`: the block readout

It keeps the `block` property and its layout rect (276 × 64). It does not hang: delete the chains.

- Four `--sys` corner brackets (12 px arms, 1.5 px) frame it.
- `BLOCK` in Oxanium 600 15 px `--fg-3` sits to the left of the number, and the number is JetBrains Mono 700 30 px
  `--fg` with text glow. `SEPOLIA` is centred under them in Oxanium 600 14 px `--fg-4`, letter-spaced 0.2em.
- On a new block, each changed digit flickers in, 60 ms apart, left to right.
- The `clock` trace lands at its bottom centre, as now.

### `<egb-gauge>`: gas as a bar

It keeps the `gwei` property. It is no longer analogue: delete the bezel, dial, needle and pump glyph.

- Replace `layout.gauge` (a centre and radius) with `layout.gas: Rect`: landscape `{ x: 764, y: 40, w: 88, h: 48 }`,
  portrait `{ x: 448, y: 150, w: 88, h: 48 }`. Update whatever reads it, and the tests.
- **The bar** has 16 vertical segments, 4 × 16 px with 1.5 px gaps, covering 0–5 gwei. Lit segments are `--sys` with
  bloom and unlit ones `--sys` at 10 %. All segments are one colour: heat is not shown, so it can't be mistaken for a
  seat colour.
- Under the bar is a readout like `1.8 GWEI`, in mono 15 px `--fg-2`.
- When the value changes, the segments that change switch one at a time from the old end toward the new, 30 ms apart.
- The lit-segment count is a pure function, `litSegments(gwei)`, with a unit test covering 0, 5, values over 5 and
  negative values.

### `<egb-fact icon>`: a data tag

It keeps `icon` (`players`, `clock`, `coin`, `shield`), its text and its 44 px height. Rename `press(delayMs)` to
`rez(delayMs)` and update the caller.

- A chamfered frame (8 px, from `frame.ts`) at idle brightness (30 %), with a `--void-2` fill.
- The existing line icon, redrawn as a 1.5 px `--sys` stroke at 18 px, then the text in Oxanium 600 17 px `--fg-2`.
- No pins, epoxy or pin-1 dot.

### `<egb-key>`: a light key

It keeps the real `<button>` inside, the click dispatch, filling its box, `breathe`, `disabled` and `selected`.
`variant` becomes `primary` (the default), `ghost` or `alert`, replacing `brass` and `metal`. Update every caller:
Back is `ghost`, `REFUND ALL` is `alert`, and everything else is `primary`.

- A chamfered frame (14 px) with a `--void-2` fill. The label is Syncopate 700 at 0.36 × the key's height (26 px on
  the 72 px Play), centred, letter-spaced 0.04em.
- **`primary`:** the line is at 100 % with bloom, a `--sys` fill sits at 8 %, and the label is `--fg` with text glow.
- **`ghost`:** the line is at 35 % with no bloom, and the label is `--fg-3`.
- **`alert`:** like `primary`, but in `--alert`.
- **`selected`** (the chosen stake): a solid `--sys` fill with a `--void` label.
- **`disabled`:** the line is at 12 % and the label at 25 %. It has no press and no hover.
- **Press:** an overlay copy of the shape in `--sys-hot` flashes to 0.9 and back over 90 ms, and the key scales to
  0.97 and back. It does not travel down: there is no physical edge any more.
- **`breathe`** (`TAP TO START`): the bloom layer's opacity goes 0.35 ↔ 1 over 2.4 s, ease-in-out, forever. Under
  reduced motion it holds at 0.7.

### `<egb-cart game title>`: a game program

It keeps `game`, `title`, `focused`, `pressed` and its 176 × 186 design size. Delete the keycap, housing, glass,
rivets, cover and brass `SOON` plate.

- A chamfered frame (16 px, top-right and bottom-left) at 30 % idle, with a `--void-2` fill.
- **Art window** (the top 58 %): a faint inner grid (16 px pitch, `--sys` at 6 %) with the game's art in light lines.
  - **Quick Draw:** a lightning bolt, outlined in 2 px `--sys-hot` with `--sys` bloom, and three short spark strokes.
  - **Stock Duel:** four candlesticks in 2 px lines, alternating `--p1` and `--p2`, with wicks.
- **Title** in the bottom part: Syncopate 700 18 px `--fg-2`, centred, two lines allowed (`QUICK / DRAW`).
- **Sealed** (Bet on X, B17): the art window is filled with static diagonal hatching (1 px `--sys` at 8 %, 10 px
  pitch). The title is `--fg-4`, with a small outlined `SOON` tag (Oxanium 600 14 px, a 1 px `--fg-4` frame) under it.
  A sealed cartridge can be focused (Play reads `SOON`, disabled), and its frame never goes above 50 %.
- **`focused`:** the cartridge lifts 12 px on `--ease-spring` (420 ms). Only once it has risen does its frame go to
  100 % with bloom (180 ms), a 2 px `--sys-hot` foot bar under the frame fade in, and the title turn `--fg`.
- **Losing focus:** it drops back and dims over 200 ms.
- **`pressed`** (launch): the whole frame flashes `--sys-hot` (90 ms), then the cartridge settles 6 px down.

### `<egb-txbar>`: the transaction strip

It keeps `show(tx)`, `hide()` and its rect.

- A panel-style chamfered frame with a `--void-2` fill.
- **Top line:** the kind and amount in Oxanium 600 16 px `--fg` (`FAUCET +100 EGB`, `STAKE 2×10 EGB`,
  `PAYOUT 20 EGB`, `REFUND 10 EGB`). The hash cell is mono 14 px `--fg-3` (the shortened hash, or `SIMULATED`).
- **Steps:** `SIGNED › SENT › IN BLOCK n › PAID` in Oxanium 600 14 px. A reached step is `--sys` with text glow, and
  the step just reached flickers once. An unreached step is at 22 %.
- `show()` on a hidden strip rezzes it, and `hide()` derezzes it.

### `<egb-panel>`: replaces `<egb-plate>`

Its children are its content, sized from `font-size`.

- A chamfered frame (12 px) at 45 % with corner ticks on the two uncut corners.
- A fill of `rgb(1 4 9 / 0.88)`. This is plain alpha, not `backdrop-filter`.
- Text in Oxanium 600 `--fg-2`. Nothing is engraved and there are no screws.
- Drop the variants.

### Other parts

- **Blockies:** `blockie.ts` stays, along with its test. The launcher draws every blockie as the LED grid in the seat
  colour, including the seat panels. `blockieSvg` stays only if something still uses it.

## The in-game overlay

Same contents and the same `game`-pose geometry: the compact ports, the clock scaled 0.78 and moved up 14 px, and the
stake chip.

- **Stake chip:** a small chamfered panel with `--sys` line at 60 %, the text `20 EGB AT STAKE` in mono 700 15 px
  `--fg`. No brass.
- The gauge and the transaction strip stay hidden in a game, as now.

## Screens

### Boot (`shell/boot.ts`)

One step at a time, nothing overlapping, about 4 s in all. Any touch skips to the end state, as now.

1. **0–300 ms:** void.
2. **300–800 ms:** the horizon rezzes. A `--sys-hot` line at the horizon's y grows `scaleX(0 → 1)` from the core's x,
   on its own element over the canvas, which is removed once the grid shows. The `boot` cue starts here.
3. **800–1600 ms:** `core.ignite()`.
4. **1600–2500 ms:** the grid powers on outward from the core. Keep the existing `boot-cover` reveal (a void cover with
   a hole, scaled up, transform only) at 900 ms, with the cover's colour set to `--void`.
5. **2500–3000 ms:** the traces power. A white packet runs out of the core along all seven named traces at once
   (`reverse`), and each trace's unpowered line is already in the canvas beneath.
6. **From 3000 ms:** rez Player 1's port, then Player 2's 120 ms later, then the clock, then the gauge, each with
   `rez()` and 120 ms between starts.

Then the Box sends `booted` and attract takes over.

### Attract (`views/attract.ts`)

- **Title:** a kicker, `ETHEREUM`, in Oxanium 600 22 px `--fg-3` letter-spaced 0.32em, over `GAME BOX` in Syncopate
  700 64 px `--fg` with text glow (52 px max in portrait, still fitted with `fitFont`).
- **Order:** the title rezzes, then the cartridges rez left to right 90 ms apart (replacing `rack.rise()`), then
  `TAP TO START` (a `primary` key with `breathe`) rezzes and starts breathing.
- **Idle:** the ambient side-bundle packet, nothing else. Any touch, key or badge tap starts, as now.

### Home (`views/home.ts`)

Same layout and behaviour: focus by touch or arrow keys, Enter plays, and it falls back to attract after a minute
idle.

- **Title:** Syncopate 700, at most 60 px landscape and 48 px portrait, `--fg` with text glow. Facts sit under it as
  data tags, and Play is a `primary` key.
- **Focus change:**
  1. The old cartridge drops and dims.
  2. The new one lifts, then lights.
  3. Its slot feed lights, and a `--sys` light-trail packet runs along it into the core. On arrival the core swells.
  4. The title changes by a fast derez (120 ms) of the old and a rez of the new.
  5. The facts rez with 90 ms between them.
  6. Play doesn't move.
  7. The `tick` cue plays.

  The core no longer coin-turns on a focus change.
- **Play** (launch):
  1. The key flashes.
  2. The cartridge flashes and settles (`pressed`).
  3. The core coin-turns (900 ms).
  4. At the same time, every powered trace flares: a full-intensity overlay on the packets canvas fades 1 → 0 over
     300 ms.
  5. The router then derezzes Home, the machine goes to the `game` pose, and the game screen rezzes in.

### Moving between views (`shell/router.ts`)

Keep the logic. Replace the depth move (sink/rise) with derez and rez: the old view derezzes (300 ms) and the new one
rezzes (380 ms). A move that a newer move overtakes still never mounts. Pose transitions on the machine keep their
transform and opacity transitions: the core sinks to 0.82 in `page`, and the grid dims.

### Join, Stake, Result, Refund (`views/*.ts`, `seat-panel.ts`)

Same `page-layout.ts` rects, words and flow.

- **Seat panel:** a chamfered frame in the seat colour (35 % idle, 100 % with bloom when its story is active) with a
  `--void-2` fill.
  - **Label:** `PLAYER 1` / `PLAYER 2` in Oxanium 600 16 px, seat colour, letter-spaced 0.22em.
  - **Socket:** two concentric circles, 124 px and 108 px (100 px and 86 px in portrait), in seat colour (25 % until
    seated, then 100 % with bloom), holding the LED blockie (72 px, or 58 px in portrait).
  - **Name:** Oxanium 700 26 px `--fg`. While empty, the name slot reads `EMPTY` in Oxanium 600 18 px `--fg-4`.
  - **Status line:** Oxanium 600 17 px, in tones:

    | Tone | Status line | Panel |
    |---|---|---|
    | `ask` | Seat colour, the bloom layer breathing over 2.4 s | — |
    | `done` | Seat colour, a small ✓ glyph before the words | — |
    | `win` | Seat colour at 20 px | Frame at 100 % with a second, outer frame line 6 px out |
    | `lose` | `--alert` only for `NEEDS n EGB` | Panel at 40 % opacity |

  - `pulse()` flashes its bloom layer, as the port does.
- **Page plate:** an `egb-panel`, text Oxanium 600 19 px `--fg-2`, centred.
- **Keys:** `primary` stake keys, with `selected` on the chosen one, and a `ghost` Back.
- **Result:**
  - A winner: the banner is Syncopate 700 40 px in the winner's seat colour with text glow (`PLAYER 1 WINS`, or
    whatever it reads now), and the payout trail runs from the core to the winner's port.
  - A draw: `DRAW · STAKES RETURNED` in `--sys`, with a trail to both ports.
  - Rematch is `primary` and Home is `ghost`.
- **Refund:**
  - The head is Syncopate 700 30 px `--alert` with text glow.
  - The timeout lines are mono 18 px `--fg-2`, with the block countdown in `--alert`.
  - The page plate's frame is `--alert` at 60 %. `REFUND ALL` is an `alert` key, and the note beside it is
    `--fg-3`.

## Demo mode

### Removed

Delete these, and anything they alone import:

- `demo/desk.ts`, `demo/puck.ts`, `demo/oled.ts`, `demo/oled-font.ts`, `demo/oled-font.test.ts`, `demo/badges.ts`,
  `demo/demo.css`.
- `deskHeight` in `AppOptions`. The screen area is now the whole window.

Rename `DESK_BADGES` to `DEMO_BADGES` in `link/sim/badges.ts` and fix the comments that mention a desk (including
`SimControl.badges`). Keep the sim's station model and `StationView`: the real stations will need them, and the sim's
tests cover them.

### How you tap without hardware

This needs a new `onSeatTap?: (seat: Seat) => void` in `AppOptions`. `main.ts` passes `(s) => sim.tap(s)` in demo
mode only. Box mode gets no on-screen taps, so the real stations (and A/L on a laptop) stay the only way to tap.

- **Targets:** the app adds one `pointerdown` listener on the screen area, in the capture phase.
  - An element with `data-seat` taps that seat. Ports and seat panels carry `data-seat`.
  - In the `game` pose, a touch below the overlay (y > 130 landscape, y > 150 portrait) on the left half taps seat 0
    and on the right half seat 1. The game screens take no pointer input, so nothing conflicts.
  - A seat tap stops propagation, so it doesn't also start attract or press anything under it.
- **Feedback** for a zone tap: a seat-colour ring (a 2 px line with bloom) scales 0.2 → 1.6 from the touch point while
  its opacity goes 0.9 → 0 over 360 ms. Port and panel taps already pulse.
- **The bot:** while the bot holds seat 2, taps there do nothing (the sim ignores them already), and its port shows a
  small `BOT` tag in Oxanium 600 14 px `--fg-3`.
- **Keys:** `demo/keys.ts` (A taps Player 1, L Player 2) stays, in both modes. In demo mode, the ports show their key
  hints.

### The DEMO tag (`demo/demo-tag.ts`, `demo/demo.css` rewritten small)

It is always visible in demo mode, as the plan requires. It is fixed to the window's bottom-right corner, 16 px in,
above the stage.

- **Collapsed:** a chamfered panel 36 px tall with `DEMO` in Oxanium 600 15 px `--fg`, a 6 px lamp (`--fg-4`, or
  `--alert` with bloom while the power is cut, when the tag reads `POWER CUT`) and a chevron.
- **Open** (a tap or Enter): a 260 px panel opens upward with a rez, holding three rows, each 48 px tall:
  1. `CUT POWER`: a light switch, a 44 × 22 pill track with a sliding knob (transform). The track line is `--alert`
     when on. It calls `sim.setPower`.
  2. `OPPONENT`: a two-way segmented control, `VS BOT | HOT SEAT`, with the chosen side filled `--sys`. It calls
     `sim.setOpponent`.
  3. `SOUND`: a switch. It calls `sound.setMuted` and is remembered as now.
- **Closing:** a tap outside, Escape or the chevron closes it with a derez.
- Its pointer events never reach the stage. It stays in step with `sim.subscribe`.

### Intro (`demo/intro.ts`)

The one-time intro is now an `egb-panel`, centred, at most 560 px wide. It rezzes in after the boot finishes, not
over it. It reads:

- `DEMO` as a kicker, then `TWO WAYS TO TAP` in Syncopate 700 28 px.
- `TOUCH A PLAYER'S FRAME, OR THEIR HALF OF THE SCREEN IN A GAME`
- `PRESS A FOR PLAYER 1, L FOR PLAYER 2`
- A rule, then `VS BOT, HOT SEAT AND CUT POWER ARE IN THE DEMO TAG`.

Under it is a `primary` OK key. OK or Escape dismisses it for good. The storage value becomes `gamebox-intro=2` (show
unless it equals `2`), so returning visitors see the new taps once.

## Sound (`shell/sound.ts`)

Keep the engine (synthesized WebAudio, made on the first gesture, never throws, mute remembered). Retune only the cues
the launcher owns, toward a dark analogue-synth feel. Leave `seal`, `flip` and `tick` alone, because the games use
them.

| Cue | New sound |
|---|---|
| `boot` | Two detuned saws (55 Hz and 55.4 Hz) plus a 110 Hz saw, through a low-pass sweeping 180 → 2600 Hz over 1.6 s. Gain attacks over 0.6 s and releases by 2.8 s. At 1.0 s, a quiet 1760 Hz sine shimmer for 0.6 s. |
| `tap` | A square wave gliding 1200 → 1800 Hz over 45 ms, low-pass 4 kHz, gain 0.18. |
| `block` | A 62 Hz sine for 140 ms plus a 10 ms high-passed noise click at 3 kHz. |
| `error` | Two saws (98 Hz and 104 Hz) for 160 ms, twice, 60 ms apart, low-pass 900 Hz. |
| `win` | A saw arpeggio of A3, E4, A4, C♯5 and E5, 90 ms apart, low-pass 3 kHz; the last note held 600 ms. |
| `lose` | Saw E4 then A3, 220 ms each, low-pass 1200 Hz. |

## Performance, motion and accessibility rules

These rules still hold:

- 60 fps on a Pi 5 at 1280×800, and it scales to 1920×1080 and a 390×844 phone.
- Only transform and opacity animate.
- The static grid is cached per layout and scale, and the packets canvas draws only while something is in flight.
- Never animate more than about 12 layers at once. The boot's steps are sequential for this reason too.
- **Reduced motion:** end states with 160 ms fades, no flicker, no breathing (it holds at 0.7), no ambient packets, and
  no shake (the alert flash still shows).
- Every interactive element keeps a real button or a role and an `aria-label`. The DEMO tag and its controls work by
  keyboard.

## Files at a glance

- **New:** `shell/rez.ts` (+ test), `parts/frame.ts`, `parts/panel.ts`, `demo/demo-tag.ts`.
- **Renamed:** `shell/board.ts` → `shell/grid.ts`, `parts/plate.ts` → `parts/panel.ts`.
- **Rewritten:** `parts/core.ts`, `port.ts`, `clock.ts`, `gauge.ts`, `fact.ts`, `key.ts`, `cart.ts`, `txbar.ts`,
  `eth-mark.ts`, `part.ts`'s shared materials (drop the LCD frame, glass and screws), `shell/packets.ts`'s drawing,
  `shell/boot.ts`, `shell/shell.css`, `views/views.css`, `views/seat-panel.ts`, `demo/intro.ts`, `demo/demo.css`,
  `tokens.css`, `fonts.css`.
- **Edited:** `shell/layout.ts` (`horizon`, `gas`), `shell/machine.ts` (grid, `refuse`, the stake chip, packet
  colours), `shell/app.ts` (full window, `onSeatTap`, tap zones and the ripple), `shell/router.ts` (derez and rez),
  `views/attract.ts`, `home.ts`, `rack.ts`, `join.ts`, `stake.ts`, `result.ts`, `refund.ts`, `main.ts`,
  `link/sim/badges.ts` and `control.ts` (the rename and comments), `apps/box/package.json`.
- **Deleted:** `parts/seg.ts`, the desk, puck, OLED, OLED font (+ test) and badge-card modules.

## Docs and plan

- **`apps/box/src/screen/README.md`:** rewrite the Parts table, the Shell list and the Demo section to match exactly
  what you built. Describe the look in one paragraph at the top.
- **`plan/game-ui.md`:**
  - Rewrite the design-language bullets in §2 and all of §3 (rename it "The look: the Grid"), with the palette, light,
    type and motion rules above.
  - Update §4's wording (no brass, no desk), the §6 tree, §7 Demo mode (taps on screen, the DEMO tag, the new intro)
    and §8's glow rule.
  - In §10, replace the puck line with "All three input paths work: touch a frame, touch a half in a game, A / L".
  - Add unticked lines for the Grid look on every launcher screen, and for 60 fps on the Pi.
- **`plan/game-ui.html`:** carry the same changes into it (it mirrors the Markdown, so check `git log -p` on both to see
  how they were kept in step). Republish it to the same name and date it was published under (the plan's URL is
  `https://plans.georgekm.com/ethereum-game-box-game-ui-2026-11-06/`), using the `plans publish` command shape from
  `CLAUDE.md`.
- Don't deploy the demo to Cloudflare Pages. Say when it's ready and ask first.

## How to work

- Small commits, each one doing one thing. A good order: tokens and fonts → `rez.ts` and the router → grid, traces and
  packets → core → port, clock and gauge (delete `seg`) → frame, key, fact, cartridge, panel, txbar and the stake
  chip → pages → boot, attract and Home motion → remove the desk and add the taps, DEMO tag and intro → sound →
  README and plan.
- Each commit message says what changed and ends with the four team `Co-Authored-By` trailers from `CLAUDE.md`.
- Run `pnpm typecheck`, `pnpm test` and `pnpm build` before every commit, and keep them green.
- After each visual step, run the demo (`pnpm --filter @egb/box dev`). Screenshot boot (mid-sequence), attract, Home
  (both cartridges focused), Join, Stake (a stake chosen and one seat signed), each game's overlay, Result (a win and
  a draw), Refund, the DEMO tag open and the intro. Take them at 1280×800, 1920×1080 and 390×844. Look at each one and
  fix what's wrong before moving on.
- Check performance with a Chrome performance trace at 4× CPU throttling (standing in for the Pi) across the boot, a
  focus change on Home, a launch and a payout. No long frames, and nothing but transform and opacity in the animation
  tracks.
- Turn on reduced motion and walk the whole flow once.

## Done when

- No skeuomorphic material remains in the launcher: no screws, plates, chips, copper, brass, gunmetal, chains,
  needles, LCD segments, keycaps, wood or pucks.
- Boot, attract, Home, Join, Stake, Result, Refund and the in-game overlay all wear the Grid look as specified, and
  every entrance and exit is a rez or derez.
- Quick Draw and Stock Duel look exactly as before, and the games' code and CSS are unchanged.
- Demo mode plays end to end against the bot and in hot seat, using screen taps alone, and also using A / L alone.
  CUT POWER reaches Refund, and `REFUND ALL` pays both stakes back.
- `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and the new pure helpers (`rez` keyframes, `litSegments`) are
  tested.
- The README and the plan describe what was built, and the plan page is republished.
- Say plainly that it has not yet run on the Pi with real badges, which `CLAUDE.md` requires before the feature counts
  as done.
