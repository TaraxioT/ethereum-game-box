# The screen

The Box's touchscreen: a stage of physical parts on a circuit board, drawn from `BoxState` and talking to the Box
only through `BoxLink` (`core/types.ts`). Vite and TypeScript, small custom elements, no UI framework. The look is
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
| `<egb-core>` | The world computer: a black glass sphere in a thick gunmetal collar on a thin base ring, a lavender neon line between them; the Ethereum mark inside, front on, lit from behind; window reflection, specular point, Fresnel rim, the board's neon caught in its lower curve. | `glass`, `collar`: radii in px. It fills its parent and centres its drawing there. `dark`: unlit. `swell()`, `coin()`, `ignite(): Promise<void>`. | Holds still. `swell()`: the glass and its light swell once (a transaction landed, a block sealed). `coin()`: the mark turns once like a coin, 900 ms (a game loads). `ignite()`: from `dark`, light comes up in the glass, then the mark, then the rim, ~900 ms (boot). |
| `<egb-port>` | A player's port in a top corner: a gunmetal socket with a neon ring (Player 1 orange, Player 2 cyan), a tile whose LED matrix shows the badge's blockie in the seat's neon, the badge's name, the balance on an amber `<egb-seg>` with an EGB legend. Empty: unlit ring, engraved `TAP BADGE`. | `seat` (`0` reads rightwards from a ring at the left; `1` mirrors it). `compact`: drawn at 70 % from its top outer corner (the in-game overlay). `set(seat: SeatState)`, `pulse()`. Designed at 380 × 96; the ring's centre sits 52 px in from the outer side, halfway down. | A badge arriving strikes the ring like a neon tube and lights the tile; leaving fades the ring. Balance changes roll. `pulse()`: the ring flashes once (a tap). |
| `<egb-clock>` | The chain clock: a bevelled LCD module hanging on two short chains, `BLOCK 12,071,233` in mint seven-segment digits, `SEPOLIA` engraved on its lower lip. | `block` (number). Designed at 276 × 64; the chains rise out of the top of its box. | Each new block rolls the changed digits one at a time. |
| `<egb-gauge>` | The analogue gas gauge: a chrome bezel, a dark dial with ticks from 0 to 5 gwei (cold to hot), a gold pump glyph, an amber needle, a mint readout plate under it (`1.8 GWEI`). | `gwei` (number). Fills its square box; the readout hangs just below it. | The needle eases to each new value over 1.2 s. |
| `<egb-fact>` | A fact about the focused game as an IC chip: dark epoxy body, silver pins top and bottom, a pin-1 dimple, a line icon and a word in silkscreen. | `icon`: `players`, `clock`, `coin` or `shield`. Text: the word. `press(delayMs)`. Height from its box (44 px default), width from the word. | `press()`: after the delay it comes down, presses into the board and settles (Home presses each in turn when the focus changes). |
| `<egb-key>` | A physical key. `brass`: a bright bevelled gold frame round a brushed, warmer face, engraved letters, a bronze edge under it. `metal`: the gunmetal secondary key. A real `<button>` inside. | `variant` (`brass` default, `metal`), `breathe`, `disabled`. Text: the label. Dispatches a normal `click`. Fills its box. | Travels down on press (the cap covers more of its edge). `breathe`: a slow gold light breathing round it (`TAP TO START`). `disabled`: dark, no travel. |
| `<egb-cart>` | A game's cartridge: a gunmetal keycap in a wider clipped housing; a dark glass screen with the title in arcade caps and the game's art on the glass (Quick Draw: a marigold bolt with sparks; Stock Duel: orange and cyan candlesticks; `new-game`, the Box's blank cartridge: a dashed frame and a plus). A game without art is sealed: a riveted cover, the title engraved, a brass `SOON` plate. | `game` (`quick-draw`, `stock-duel`, `bet-on-x`, `b17`, `new-game`), `title` (the printed title), `focused`, `pressed`. Designed at 176 × 186. | `focused`: the keycap rises 16 px on a spring, and only then a lavender strip lights at its foot and round the housing's rim. Idle: no light at all. `pressed`: the keycap seats 8 px down (launch). |
| `<egb-txbar>` | The transaction-progress LCD strip: the kind and amount (`FAUCET +100 EGB`, `STAKE 2×10 EGB`, `PAYOUT 20 EGB`, `REFUND 10 EGB`), a hash cell (shortened hash, or `SIMULATED`), and the steps `SIGNED › SENT › IN BLOCK n › PAID`. | `show(tx: Tx)`, `hide()`. Designed at 380 × 52. | Each step lights mint as the transaction reaches it; unreached steps stay ghosts. The strip fades in on `show` and out on `hide`. |
| `<egb-plate>` | An engraved plate with a screw in each corner: `DEMO`, `SOON`, the instruction plate. | `variant` (`brass` default, `metal`). Its children are its content (words, a switch, several lines). Sizes from `font-size`. | Never. |
| `<egb-lcd>` | A text LCD in the clock's bevelled frame and glass: the agent's words while a game builds, the Designer's status and captions. The newest line sits at the foot of the glass, the older ones dimmer above it, the oldest going under the bezel's shade; lines wrap. | `tone` (`mint` default, `amber`), `caret` (a blinking block cursor: the machine is working). `push(text, mark?)` (`bad` red, `ok` bright), `set(lines)`, `clear()`. Fills its box; `font-size` sets the text. | `push`: the lines step up by the new one's height as it fades in. The caret blinks by opacity. |
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
  in-game stake chip) and the `Machine` API views use: `pose` (`home`, `page`, `game`), `coin`, `feed`, `run` (a
  packet along a named trace, into the core or out of it) and `swell`. It turns transaction steps into moments: a packet from the port when a stake is sent, a swell
  when it lands in a block, a packet out to the port for a payout.
- `router.ts`: mounts the view for the Box's phase and moves between views in depth (the old sinks, the new rises).
  A move that a newer one or a rebuilt stage overtakes never mounts.
- `boot.ts`: one step at a time: the core ignites, the board powers on outward from it, the ports and clock come up.
- `app.ts`: the screen area (the window less the desk), the stage, the machine and the router; rebuilds the stage
  when the window turns between landscape and portrait.
- `sound.ts`: synthesized WebAudio cues, muted by localStorage `gamebox-muted=1`.
- `dom.ts`: `el`, `place`, `play` (a Web Animation; under reduced motion a 160 ms fade to its end state), `fitFont`, `fitWidth`, `wait`, `calm`.

## Link

`link/` holds the two `BoxLink`s. `main.ts` picks one by the build's mode: `VITE_EGB_MODE=demo` (the default, `pnpm
build`) runs `SimLink`; `box` (`pnpm build:box`, for the Pi's kiosk) runs `LiveLink` to the Box server that served
the page, at `/link` on the same origin. Views read the Box's clock from `link.now()`, never `Date.now()`: on
`SimLink` they are the same clock; on `LiveLink` it is the screen's clock plus the link's offset.

| Module | What it is | API |
|---|---|---|
| `sim.ts` | `SimLink`: the core (`src/core/`) in the browser, on the browser's clock, a ledger in memory and the team games, with the bot on Player 2. The desk taps with a whole tap at once (touch, then done with a fresh roll). | `createSimLink({ seed? }): SimLink` |
| `control.ts` | `SimControl`, what the desk drives and BoxLink doesn't have: tap a seat, the opponent switch, the power cut. `SimLink = BoxLink & SimControl`. | types |
| `live.ts` | `LiveLink`: BoxLink over the WebSocket. The whole state on connect, then each event in order; a `state` message after the first is the stations moving (`stations` event). Commands go up only while connected. Reconnects after 250 ms, doubling to 4 s, and starts over from the whole state (an `init` event). | `connectLive({ url, socket?, localNow? }): Promise<LiveLink>` (resolves on the first state) |
| `offset.ts` | The link's clock offset: the largest `boxNow − localNow` of the last 10 s (a message only ever arrives late). | `createClockOffset()` |
| `reuse.ts` | Structural sharing: every part of a new state equal to the last one's keeps the last one's object, so views that compare by identity behave as on `SimLink`. | `reuse(prev, next)` |

The shell carries a restarted Box on: a server that comes back in `boot` under a screen that has already booted is
sent `booted` at once (`shell/app.ts`).

## Views

`views/` are the screens the router mounts. Each is a `ViewFactory` (`view.ts`): it draws from `BoxState`, animates
on `BoxEvent`s and acts only through `link.send`.

- `routes.ts`: phase → view and pose (`build` → the game builder).
- `attract.ts`: the Box's name, the rack rising, a breathing brass `TAP TO START`.
- `home.ts`: the focused game's title, IC-chip facts and brass Play, and the rack (`rack.ts`). Touch or arrow keys
  focus; the cartridge rises, its feed lights and the core turns once. Enter plays. On the Box (`build:box`) the rack
  ends in the blank NEW GAME cartridge: it focuses like a game, on the screen alone (the Box's focus is always a game),
  and its key, DESIGN, sends `build`.
- `rack.ts`: the rack's entries (`rackOf(games)`: each game's cartridge, then NEW GAME where the Box has the builder)
  and where each stands (`rackSlots`: the layout's housings, each fed by a trace, then on along the row; a row too long
  for the stage closes up to fit, as in portrait, where the cartridges past the fourth then stand off the traces).
- `join.ts`, `stake.ts`, `result.ts`, `refund.ts`: pages round the core (`page-layout.ts`), each with a seat panel
  per player (`seat-panel.ts`), a plate under the core and keys at the bottom.
  Refund's `REFUND ALL` key (once the stakes unlock) sends every refund still owed, so the Box never waits on a
  player who walked away.
- Game screens live with their games in `src/games/<game>/screen.ts`.

## The game builder

The Box's `build` phase (the box build only): the Designer and the Build screen, talking to the server's builder
routes (`server/README.md`) with the launcher token, and following its event stream.

| Module | What it is |
|---|---|
| `views/builder.ts` | The routed view: holds the stream (`hello`, then `designer` and `forge` events; it reconnects and starts over), shows the Designer or the Build screen and moves between them in depth (the old sinks, the new rises), setting the machine's pose (`page` for the Designer, `home` for a build). A newly queued build takes the screen at once. On entering, a design left half-way is picked up; one already built (the newest job is that brief, done), or none, starts afresh. While the player works and while a build streams in it sends `build`, so the Box only times out back to Home when the builder is left alone. |
| `views/designer.ts` | The Designer on a page round the sunken core: the step's name and its question (as big as fits) on the left, the step's brass keys under it; the brief on the right; the status LCD under the core (the model reading, what was heard, a refusal in the Box's words); along the bottom HOME, BACK, a big typed-answer field with SEND (Enter sends), and HOLD TO TALK. A refusal goes on the LCD; a `stale` design is fetched again. Locked while a build runs; BUILD stays dark when the provider can't build here. |
| `views/build.ts` | The World Computer making the game, on the whole lit board: the kicker (`BUILDING`, `CHECKING`, `READY TO PLAY`, `DIDN'T BUILD`) with a `SIMULATED` plate for a sim build, the title, the step at work and an amber elapsed clock; the agent's words on a mint LCD; the brief on the right; the four compile plates (manifest, type check, bundle, icon) standing in the rack's housings. The result: `HOME`, or the error and `DESIGNER` (the brief is kept) and `HOME`. |
| `views/brief-plates.ts` | The brief as engraved plates, one per field: gunmetal once settled, brass for the question asked, faint while open. Says which fields filled. |
| `views/builder-layout.ts` | Where the builder's pieces stand, landscape and portrait; a compile plate's place in a housing. |
| `views/builder-link.ts` | The page's line to the builder: takes the launcher token from its meta tag at load (and removes the tag), sends it on the builder's routes only; `getJson`, `postJson`, `postBytes`, `getBytes`, `BuilderError` (status, the Designer's code, the Box's words); `openBuilderStream` (a fetch read frame by frame, since EventSource can't send a header; reconnects 0.5 s doubling to 4 s). The test page uses it too. |
| `views/builder.css` | Every style above. |

How it moves:

- **Designer.** A new question's keys rise in one after another. A field that fills presses its plate in and runs a
  packet up a cartridge feed into the core, which swells. While the model reads an answer the LCD's cursor blinks and a
  packet runs down the clock's feed into the core every 1.1 s; when it lands, the LCD says whether it got anything.
- **Build.** Each tool call the agent makes runs a packet into the core along its kind of work's trace: reading and
  searching down Player 1's copper (lavender), writing and editing down Player 2's (mint), the build check down the
  clock's feed (gold); one packet a trace at a time, so a burst stays readable. A failed tool call runs a red packet out
  of the core. A build check sets every compile plate checking (its lamp breathing amber); each check that lands lights
  its plate mint or red, seats it, and runs a packet up its housing's trace. The result turns the core once (a game
  loaded) and raises the keys. Events older than two seconds are a replay (a screen that came in late): they set the
  end state without a moment.
- Only transform and opacity animate; every glow is static. Under reduced motion the screens show end states and the
  packets land at once.

## Voice

`voice/`: the Designer's push-to-talk, as the Box's voice port has it (`GET /api/builder` says which). Nothing here
talks to anything but the Box: every ElevenLabs call is the server's, behind its own monthly budget.

| Module | What it is | API |
|---|---|---|
| `designer-voice.ts` | The key's behaviour. Mock voice (the default): no microphone; the press shows the scripted player's next line (`GET turns`) and the release sends an empty take, which the Box "hears" as that line and reads. ElevenLabs: the key records while held and the take goes up to be transcribed; each new question is spoken from the clip the Box made (its words are on screen either way). | `createDesignerVoice(status, muted, hooks): { mode, press(), release(session), speak(session), stop() }` |
| `recorder.ts` | Push-to-talk recording: MediaRecorder on a mic opened at the press and closed at the release (its tracks stopped), one webm/opus blob per take; a take is cut at 15 s, and one under 0.3 s is a tap, not an answer. | `createRecorder()`, `canRecord()`, `MAX_TAKE_MS`, `MIN_TAKE_MS` |
| `clips.ts` | Plays a spoken clip: fetched with the token (an `<audio src>` can't send it), decoded and played through WebAudio, one at a time; muted (localStorage `gamebox-muted=1`), nothing plays. Never throws: the question stays on screen. | `createClipPlayer(muted): { play(clip), stop() }` |

## Demo

`demo/` draws the hardware a browser doesn't have: a dark walnut bench with a gunmetal rail along the bottom of the
window, below the Box's screen. On it are the two tap stations (Player 1 left, Player 2 right), the badges between
them, and the engraved `DEMO` plate with its controls. The desk drives the simulated Box through `SimControl`
(`link/control.ts`) and listens to it (`sim.subscribe`) to keep the OLEDs, the buzz motors, the seated badges and
the switches in step. Call `registerParts()` first: the plates are `<egb-plate>`s and OK is an `<egb-key>`.

| Module | What it is | API |
|---|---|---|
| `desk.ts` | The bench and its layout. Landscape: one row (puck, badges, plate, puck), with the wide plate, or the tall one when the window is narrow. Portrait, or a landscape too narrow for a row: the badges on top, the pucks in the bottom corners with the plate between them. The plate is a metal `<egb-plate>`: `DEMO`, a bat-handle `CUT POWER` toggle with a red pilot lamp that lights while the power is cut (`sim.setPower`), a `VS BOT / HOT SEAT` slide switch (`sim.setOpponent`) and a mute key with a speaker (`sound.setMuted`). | `mountDesk(host, sim, sound): Desk`. `Desk.height(viewW, viewH)`: ~20 % of the height in landscape (130–220 px), ~26 % in portrait (180–260 px); it also lays the desk out for that size. `deskLayout(w, h)` is the sizing, pure. |
| `puck.ts` | One tap station: a round dark puck, bevelled and lit from the top left, a seat-colour NFC ring (2.5 px neon, ≤ 8 px glow) round its OLED, `P1`/`P2` engraved on the rim and its key (`A`/`L`) on a tiny keycap. With the bot in seat 2, puck 2 wears a `BOT` plate and ignores clicks and drops. After an accepted tap its OLED shows the station's DONE screen for 0.6 s, as a real station does after a read. | `createPuck(seat, sim): Puck` with `show(view)`, `buzz()`, `refuse()`, `flash()`, `done()`, `setBot(on)`, `hits(x, y)`, `arm(on)`, `size(diameter)`, `dispose()`. |
| `oled.ts` | The station's 72 × 40 one-bit panel (the SSD1306 0.42″ on the real station) on a real canvas of that size, blue-white on black glass, drawn bigger than life and scaled with hard pixel edges (a whole number of device pixels per panel pixel when that keeps at least 85 % of the room; otherwise the room itself, still hard-edged; a soft scale below one device pixel, so type doesn't lose rows). | `createOled(): { el, show(view, face?), size(fitWidth) }`, `panelWidth(fitWidth, dpr)`. |
| `oled-font.ts` | The pixel font and the panel layout, pure. 5 × 7 glyphs as base-32 rows, trimmed to their ink; digits, A–Z, `! ? . : ; , - + × = / % $ # ' " ( ) < > * @ & _ · → ← ▲ ▼`; a hollow box for anything else. It draws the station's own screen model (`@egb/sdk`'s `StationView`): the tag as dark letters in a lit badge at the top left, the big line under it at 2× when it fits across the panel (else 1×), the small line at the foot on up to two rows. A `face` shows a tap in progress: `hold`, `sign`, `done` or `fail`, each the Box's `BIG\|small` override or the station's own words. Tested in `oled-font.test.ts`. | `glyph`, `hasGlyph`, `textWidth`, `drawText`, `fit`, `wrap`, `bigLine`, `smallLines`, `faceLines`, `stationPixels(view, face?): Pixel[]`. |
| `badges.ts` | The desk's badges (`sim.badges` less the bot's) as NFC cards: violet PVC, a punched lanyard slot, a gold chip, the blockie, the name. Pointer Events drag them (mouse and touch). Dropped on a puck, the card lands on it, taps (`sim.tap(seat, badge)`) and slides home; dropped anywhere else it springs back. A seated badge lights a seat-colour lamp. Cards overlap when the tray is narrow. | `createBadgeTray(sim, pucks): { el, update(state), size(cardHeight), dispose() }`, `CARD_RATIO`. |
| `keys.ts` | A taps Player 1, L taps Player 2, in the demo only (the Box has real stations). Held keys, modifier shortcuts and typing in a field don't tap. | `bindTapKeys(sim): () => void` |
| `intro.ts` | The one-time brass plate: the four ways to tap (drag a badge onto a puck, click or touch a puck, press A, press L), `VS BOT or HOT SEAT`, `CUT POWER to see a refund`, and a brass OK. OK or Escape dismisses it for good (localStorage `gamebox-intro=1`). | `showIntroOnce(host)` |
| `demo.css` | Every style above, imported by `desk.ts` and `intro.ts`. Desk sizes scale with `--u` (1 on a 160 px landscape desk); a puck from `--d`; a badge from its own width. | |

`shell/sound.ts` (`createSound(): Sound`) goes with it: every `Cue` synthesized with WebAudio (tap a click, block a
soft low tick, seal a warm chime, flip a card flick, tick a wood tick, win a rising brass arpeggio, lose a falling
two-note, error a dull double buzz, boot a power-on swell). The AudioContext is made on the first user gesture;
until then, and while muted, cues are silent. Muting is remembered (localStorage `gamebox-muted=1`). It never throws.

How it moves: the buzz is a 220 ms shake of the puck (transform only) with a ring flash; an unaccepted tap is a
double shake; a badge read flashes the ring; a badge hovering over a puck lights its ring until it drops. The toggle
flips, the slide knob slides, the pilot lamp and the opponent lamps fade. Under reduced motion nothing shakes, the
ring still flashes, and a dropped badge goes straight home.

## Quick Draw

`games/quick-draw/screen.ts` exports `quickDrawScreen`, the `ViewFactory` the router mounts while a Quick Draw match
plays. It draws from `state.match.play` (game `quick-draw`) on the whole stage, in its own look: a western standoff at
dusk in flat layered silhouette. The Box's thin overlay sits over the top ~130 px (landscape) / ~150 px (portrait),
which holds nothing important. Each orientation has its own geometry table in `screen.ts`; portrait stands the
figures lower-left and lower-right.

| Module | What it is | API |
|---|---|---|
| `screen.ts` | The view: places the parts, runs the standoff from the game's phase and the Box's events. | `quickDrawScreen: ViewFactory` |
| `scene.ts` | The static landscape, drawn once: a graded dusk sky, a big low sun on a long horizon, three ranges of flat-topped mesas with sun-lit ridges, scrub, rocks and two saguaros, a dust haze and a band of drifting motes. | `createScene(spec): { el, sun }` |
| `sign.ts` | The flip-plate sign on its post: planked wood from layered gradients, nail heads, two iron pins, a plate with a dark painted `WAIT…` face and a bright `DRAW` face, hand-painted letters a little off square, paint wear over them. | `createSign(): { el, flip(instant?), reset(), rattle() }` |
| `figure.ts` | One gunslinger in silhouette (SVG, facing right; Player 2 mirrored), a seat-coloured rim on its sun-facing edges, hat band and bandana. Body, holstered arm and drawn arm are separate layers. | `createFigure(seat): { el, idle(), twitch(), win(), lose() }` |
| `quick-draw.css` | All its styles, imported by `screen.ts`. | |

How it moves:

- **Wait**: the sign reads `WAIT…`. A dark layer fades in from the standoff's start over the longest possible wait
  (`MAX_WAIT_MS`), quicker up to the shortest (`MIN_WAIT_MS`). The sun and the vignette beat like a heart, and the
  beat quickens once the shortest wait has passed. The figures hold. All of this is the same for every match, timed
  from `startedAt` and the Box's clock (`link.now()`), so it never gives away when the draw comes. A remounted view picks the dimming
  up where it has got to.
- **Draw** (the phase turns to `draw`, or a `cue: flip` event): the plate turns over on its pins (rotateX) with a
  swing that settles. The horizon flashes and the light comes back up.
- **Done**: the winner's arm comes up out of the holster and fires (a muzzle-flash spark, a recoil); the loser sags
  back on its heels. A brass plate drops in under each figure with its reaction time (`reactionMs`, JetBrains Mono)
  or `TOO EARLY`. A player who never tapped reads `TOO SLOW` (the other drew first) or `HELD FIRE` (the other jumped
  the gun). The winner's plate is ringed in its seat colour. A carved plank with `PLAYER 1 WINS` / `PLAYER 2 WINS` in
  seat paint swings in across the post. After an early tap the sign stays on `WAIT…` and rattles on its pins. The
  whole sequence is done in about a second, inside the ~2.4 s the Box holds it before Result.
- **Stood again**: when nobody draws within 4 s of the flip, the rules stand the standoff again (the phase goes back
  to `wait` with a new start), and the view runs the standoff from the top.
- **Taps**: each accepted `tap` event jolts that seat's figure a few pixels back, so the player feels it land.
- Only transform and opacity animate; every shadow and glow is static. Under reduced motion it shows end states: a
  fixed dim during the wait, no heartbeat, the plate already turned, the poses, plates and plank in place.

## Stock Duel

`games/stock-duel/screen.ts` exports `stockDuelScreen`, the `ViewFactory` the router mounts while a Stock Duel match
plays. It draws from `state.match.play` (game `stock-duel`) on the whole stage, in its own look: a painted study
that comes alive, a dark wood-panelled room with a warm brass lamp on Player 1's half and a cyan-glass lamp on Player
2's. The Box's thin overlay sits over the top ~130 px (landscape) / ~150 px (portrait), which holds nothing important.
Each orientation has its own geometry table in `screen.ts`: landscape stands the Rolodexes at the two ends of the
desk with the astrolabe between them on the wall; portrait puts the Rolodexes side by side at the top, the
astrolabe and the tallies in the middle, and the played cards along the bottom.

| Module | What it is | API |
|---|---|---|
| `screen.ts` | The view: places the parts, draws a state as it stands when it mounts, animates each change after that, and runs the drums' frame loop only during the pick. | `stockDuelScreen: ViewFactory` |
| `scene.ts` | The study, drawn once in CSS: raised wall panels, a rail, a walnut desk with a tooled leather blotter, the two lamps on their arms, each lamp's cone and pool of light, a vignette; brushed paint texture from layered gradients. | `createScene(places): { el, flare(seat, holdMs), hold(seat \| null) }` |
| `rolodex.ts` | One hand as a classic Rolodex: a black drum with brass bands and knobs on a lacquered stand, the cards on its rail. Every card has an index tab in the stock's colour at its own place across the top, so all the hand's tickers show; the front card is face up with its colour band, ticker, name, a draining ring and a `?` where the stats go. A plinth line says `TAP TO PLAY` or `LAST TURN`. | `createRolodex(seat, placement, sound): { el, show(hand, front, animate, played), turnTo(front), drain(share), deal(hand, front, delays), lift(card): Rect, note(text, hot), dispose() }` |
| `dial.ts` | The brass astrolabe: a bevelled rim, a band of four engraved stat sectors (`PRICE`, `AVG PRICE`, `24H MOVE`, `LIQUIDITY` in roll order, clockwise from the top left), degree ticks, a dark enamel plate, and the rete (a pierced brass pointer) under a fixed boss. SVG. | `createDial(centre, radius): { el, spin(stat, elapsedMs): Promise<void>, show(stat), rest(), dispose() }` |
| `reveal.ts` | The played cards on the blotter: face down, a cream manuscript back folded like an envelope with a wax seal (and `AUTO` stamped on it when the card was played for the player); face up, aged paper with ink rules, the ticker and company, the stock's colour as an ink band, the round's stat large and the other three below. Wax seals (SVG): green `FINALIZED`, red `SLASHED`; a brass `TIE · REPLAY` plate for a tie. | `createReveal(rests): { el, place(seat, auto, from), flip(record, animate): Promise<void>, clear(animate), dispose() }` |
| `score.ts` | The standing: a lacquered tally per seat (`PLAYER n` and three round pips that light in the seat's colour), an engraved `ROUND n` plate, and the end banner. | `createStanding(places): { els, set(score, round, animate), finish(winner, animate) }` |
| `stock-duel.css` | All its styles, imported by `screen.ts`. | |

How it moves:

- **Deal**: the cards drop onto each drum's rail one at a time, the two drums half a beat apart, the front card last;
  each lands with a `tick`. Nothing is ever laid out on the desk.
- **Pick**: a frame loop (only in this phase) reads `frontIndex` and `frontRemainingMs` at the Box's clock (`link.now()`). When the
  front card changes the drum indexes one card: the old front card rises and tips back over the top of the drum
  (rotateX about the rail, edge-on at the midpoint), then stands up again at the back while the others step forward;
  it always ends upright. While a chip on the reader is still rolling, its seat's front card is held (the rules'
  `held`): the drum stays on it and its ring stops. The ring drains with transforms only (two half rings turning in clipped windows). A
  played card lifts off the rail and flies face down onto its rest on the blotter, and that seat's lamp flares. Once
  one seat has played, the other's plinth reads `LAST TURN`.
- **Dial**: the astrolabe wakes from dim, the rete spins three turns, swings a few degrees past the stat and settles
  on it; then the sector lights. A screen joining mid-spin carries on from where the spin has got to.
- **Reveal**: both cards turn over together (rotateY); then the seals come down, squash and settle (scale and
  opacity), the winner's pip lights with a pop and its lamp flares; a tie shows the `TIE · REPLAY` plate instead. The
  next pick clears the desk and the drums close up round the cards that are left.
- **Over**: the final reveal stays, the engraved brass banner (`PLAYER 1 WINS`, `PLAYER 2 WINS` or `DRAW`, with a
  seat-coloured rule) drops in, and the winner's lamp stays bright.
- Sounds: the Box cues `tick` on each drum step, `flip` at the reveal and `seal` when a round scores; the screen adds
  only the deal's `tick`s.
- Only transform and opacity animate; every shadow and gradient is static. Under reduced motion it shows end states:
  the drum jumps to the next card, cards appear on their rests, the rete is already on the stat, the faces and seals
  are already down.
