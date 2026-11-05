# The screen

The Box's touchscreen: a stage of physical parts on a circuit board, drawn from `BoxState` and talking to the Box
only through `BoxLink` (`link/types.ts`). Vite and TypeScript, small custom elements, no UI framework. The look is
in the project plan (`plan/game-ui.md` §3): World Computer, skeuomorphic, one key light from the top left, glows
kept to their edges, only transform and opacity animating.

## Parts

`parts/` holds the Box's physical objects as custom elements, each a real-looking object with depth and edges.
Call `registerParts()` (`parts/register.ts`) once before creating any of them.

How they are built:

- Each part draws inside its own shadow root (`parts/part.ts` gives it the shared materials: the LCD frame and
  glass, screws, and the reduced-motion rule). The palette, type and motion tokens of `tokens.css` reach inside
  because custom properties inherit.
- Parts with a fixed shape fill the box the shell gives them (`width`/`height`, placed in stage px from
  `shell/layout.ts`) and scale everything inside from it; each has a default size for when nothing sets one. Parts
  that carry words (`<egb-fact>`, `<egb-plate>`, `<egb-seg>`) size from `font-size` instead.
- Text in `<egb-key>`, `<egb-fact>` and `<egb-plate>` is the element's own text, so a view can set `textContent`.
- Under `prefers-reduced-motion` every part shows its end state at once.

| Part | What it is | Attributes and API | When it moves |
|---|---|---|---|
| `<egb-core>` | The world computer: a black glass sphere in a thick gunmetal collar on a thin base ring, a lavender neon line between them; the Ethereum mark inside, front on, lit from behind; window reflection, specular point, Fresnel rim, the board's neon caught in its lower curve. | `glass`, `collar`: radii in px. It fills its parent and centres its drawing there. `dark`: unlit. `swell()`, `coin()`, `ignite(): Promise<void>`. | Holds still (the mark levitates 3 px, very slowly). `swell()`: the glass and its light swell once (a transaction landed, a block sealed). `coin()`: the mark turns once like a coin, 900 ms (a game loads). `ignite()`: from `dark`, light comes up in the glass, then the mark, then the rim, ~900 ms (boot). |
| `<egb-port>` | A player's port in a top corner: a gunmetal socket with a neon ring (Player 1 orange, Player 2 cyan), a tile whose LED matrix shows the badge's blockie in the seat's neon, the badge's name, the balance on an amber `<egb-seg>` with an EGB legend. Empty: unlit ring, engraved `TAP BADGE`. | `seat` (`0` reads rightwards from a ring at the left; `1` mirrors it). `compact`: drawn at 70 % from its top outer corner (the in-game overlay). `set(seat: SeatState)`, `pulse()`. Designed at 380 × 96; the ring's centre sits 52 px in from the outer side, halfway down. | A badge arriving strikes the ring like a neon tube and lights the tile; leaving fades the ring. Balance changes roll. `pulse()`: the ring flashes once (a tap). |
| `<egb-clock>` | The chain clock: a bevelled LCD module hanging on two short chains, `BLOCK 12,071,233` in mint seven-segment digits, `SEPOLIA` engraved on its lower lip. | `block` (number). Designed at 276 × 64; the chains rise out of the top of its box. | Each new block rolls the changed digits one at a time. |
| `<egb-gauge>` | The analogue gas gauge: a chrome bezel, a dark dial with ticks from 0 to 5 gwei (cold to hot), a gold pump glyph, an amber needle, a mint readout plate under it (`1.8 GWEI`). | `gwei` (number). Fills its square box; the readout hangs just below it. | The needle eases to each new value over 1.2 s. |
| `<egb-fact>` | A fact about the focused game as an IC chip: dark epoxy body, silver pins top and bottom, a pin-1 dimple, a line icon and a word in silkscreen. | `icon`: `players`, `clock`, `coin` or `shield`. Text: the word. `press(delayMs)`. Height from its box (44 px default), width from the word. | `press()`: after the delay it comes down, presses into the board and settles (Home presses each in turn when the focus changes). |
| `<egb-key>` | A physical key. `brass`: a bright bevelled gold frame round a brushed, warmer face, engraved letters, a bronze edge under it. `metal`: the gunmetal secondary key. A real `<button>` inside. | `variant` (`brass` default, `metal`), `breathe`, `disabled`. Text: the label. Dispatches a normal `click`. Fills its box. | Travels down on press (the cap covers more of its edge). `breathe`: a slow gold light breathing round it (`TAP TO START`). `disabled`: dark, no travel. |
| `<egb-cart>` | A game's cartridge: a gunmetal keycap in a wider clipped housing; a dark glass screen with the title in arcade caps and the game's art on the glass (Quick Draw: a marigold bolt with sparks; Stock Duel: orange and cyan candlesticks). A game without art is sealed: a riveted cover, the title engraved, a brass `SOON` plate. | `game` (`quick-draw`, `stock-duel`, `bet-on-x`, `b17`), `title` (the printed title), `focused`, `pressed`. Designed at 176 × 186. | `focused`: the keycap rises 16 px on a spring, and only then a lavender strip lights at its foot and round the housing's rim. Idle: no light at all. `pressed`: the keycap seats 8 px down (launch). |
| `<egb-txbar>` | The transaction-progress LCD strip: the kind and amount (`FAUCET +100 EGB`, `STAKE 2×10 EGB`, `PAYOUT 20 EGB`, `REFUND 10 EGB`), a hash cell (shortened hash, or `SIMULATED`), and the steps `SIGNED › SENT › IN BLOCK n › PAID`. | `show(tx: Tx)`, `hide()`. Designed at 380 × 52. | Each step lights mint as the transaction reaches it; unreached steps stay ghosts. The strip fades in on `show` and out on `hide`. |
| `<egb-plate>` | An engraved plate with a screw in each corner: `DEMO`, `SOON`, the instruction plate. | `variant` (`brass` default, `metal`). Its children are its content (words, a switch, several lines). Sizes from `font-size`. | Never. |
| `<egb-seg>` | A seven-segment LCD readout with the unlit ghost segments showing; a point or comma lights the decimal mark of the digit before it. Used by the port and the clock. | `tone` (`amber` default, `mint`), `digits` (the fewest cells; the value is right-aligned), `value` (text). `font-size` is the cell height. | Changed digits roll in turn, left to right, 70 ms apart. |

Two pure modules go with them:

- `parts/blockie.ts`: the classic ethereum-blockies identicon for an address. `blockie(address)` gives its colours
  and 8 × 8 cells; `blockieSvg(address, size)` draws it in its own colours; `blockieLedSvg(address, size)` draws it
  as an LED matrix whose LEDs a caller lights (`.c0` off, `.c1` colour, `.c2` spot). Tested in `blockie.test.ts`.
- `parts/eth-mark.ts`: `ethMarkSvg({ backlight })`, the real six-facet Ethereum mark as an SVG string, with an
  optional soft light behind it.

## Shell

`shell/` holds the Box's own objects and the machinery that places, scales and moves them.

- `layout.ts`: every anchor in stage pixels, for the 1280×800 landscape stage and the 720×1080 portrait one (core,
  ports, clock, gauge, title, facts, Play, the four rack housings, the transaction LCD). Everything else places
  itself from these, so traces always land on the parts they feed.
- `stage.ts`: `fit(layout, w, h)` scales and centres the stage in the space it gets; `createStage`, `applyFit`.
  Tested in `stage.test.ts`.
- `route.ts`, `traces.ts`: pure geometry. 45° routing, buses, sampling and clipping; `tracesFor(layout)` gives the
  named traces (`port0`, `port1`, `clock`, `slot0`–`slot3`) and the side bundles. Tested.
- `board.ts`: `drawBoard(layout, scale)` draws the static board once (plates, seams, screws, 3D parts, copper,
  neon traces, connectors) and caches it per size.
- `packets.ts`: a live canvas over the board. `run(trace)` sends a comet along the copper; `light(trace)` lights the
  focused cartridge's feed. It draws only while a packet is in flight.
- `machine.ts`: the objects that stay across views (board, packets, core, ports, clock, gauge, transaction LCD, the
  in-game stake chip) and the `Machine` API views use: `pose` (`home`, `page`, `game`), `packet`, `swell`, `coin`,
  `feed`, `anchor`. It turns transaction steps into moments: a packet from the port when a stake is sent, a swell
  when it lands in a block, a packet out to the port for a payout.
- `router.ts`: mounts the view for the Box's phase and moves between views in depth (the old sinks, the new rises).
- `boot.ts`: one step at a time: the core ignites, the board powers on outward from it, the ports and clock come up.
- `app.ts`: the screen area (the window less the desk), the stage, the machine and the router; rebuilds the stage
  when the window turns between landscape and portrait.
- `sound.ts`: synthesized WebAudio cues, muted by localStorage `gamebox-muted=1`.
- `dom.ts`: `el`, `place`, `play` (a Web Animation that resolves at once under reduced motion), `wait`, `calm`.

