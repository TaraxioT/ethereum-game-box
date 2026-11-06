# The screen

The Box's touchscreen, drawn from `BoxState` and talking to the Box only through `BoxLink` (`core/types.ts`). Vite and
TypeScript, small custom elements, no UI framework.

**The look: the Grid.** A near-black world where all brightness comes from thin emissive lines. The system's light is
cool white-blue (`--sys`), Player 1 is orange and Player 2 cyan, and red (`--alert`) only ever means something is
wrong; the system's white lines bloom blue (`--sys-glow`). The world has depth: a storm-dark sky lit from the
horizon, distant ridges and a far city, a glossy floor fading into haze, and every panel, key and tag is glass
(`--glass`) with a bevelled frame. Shapes are straight runs, 45° bends and chamfered corners, with circles only for
the core and the badge sockets; a perspective floor grid runs toward the viewer under one horizon line. Display text is Syncopate, labels
Oxanium, numbers JetBrains Mono. Every glow is static (shadows, stacked SVG strokes, or baked once into the Grid's
canvas) and reaches at most 24 px. Things **rez** in as a line of light that opens into them and **derez** back into
a line that goes out; that is every entrance and exit in the launcher. Only transform and opacity animate. The rules
are in the project plan (`plan/game-ui.md` §3). The two game screens keep their own looks; the game builder's
Designer and Build screens wear the Grid.

## Parts

`parts/` holds the Box's objects as custom elements. Call `registerParts()` (`parts/register.ts`) once before creating
any of them.

How they are built:

- Each part draws inside its own shadow root (`parts/part.ts` gives it a small shared base and the reduced-motion
  rule). The tokens of `tokens.css` reach inside because custom properties inherit.
- Chamfered parts draw their frame with `parts/frame.ts`: `frameSvg({ w, h, chamfer, corners, tone, ticks })` gives two
  SVG layers, `.frame-line` (a 2 px line in the tone over a 1 px hot core, the two cut edges lit brighter as a bevel, a
  faint inner line 4 px inside, and hot ticks on the uncut corners for panels) and `.frame-bloom` (12 px and 5 px soft
  strokes, blue for the system's light, the tone's own colour when `--frame-tone` is set); `fitFrame(box, options)` lays them in a box and keeps them
  to its size; `chamferClip` cuts the fill under them. A part lights its frame by the layers' opacity: 30 % idle,
  100 % with the bloom when active, 12 % disabled, 25 % with nothing seated. `--frame-tone` recolours a frame.
  Chamfers: keys 14 px, facts 8, panels and the strip 12, programs 16 (cut top right and bottom left; the rest cut top
  left and bottom right).
- Parts with a fixed shape fill the box the shell gives them (`width`/`height`, placed in stage px from
  `shell/layout.ts`) and scale everything inside from it. Parts that carry words (`<egb-fact>`, `<egb-panel>`) size
  from their content.
- Text in `<egb-key>`, `<egb-fact>` and `<egb-panel>` is the element's own text, so a view can set `textContent`.
- Under `prefers-reduced-motion` every part shows its end state at once.
- What moves on every block, gas reading, tap or transaction step keeps a layer of its own (`will-change`), all the
  time: the core's swell, its segments' bloom (an SVG of its own for that) and its mark, the gas segments, the
  clock's and the ports' digits, a port's flash and alarm, the strip's steps, a log's lines and cursor, a compile
  check's lamp. On the Pi's GPU, a part the browser lifts onto a layer only while it animates costs a raster of the
  screen's wide top tiles as the move starts and again as it ends (80–150 ms frames).

| Part | What it is | Attributes and API | When it moves |
|---|---|---|---|
| `<egb-core>` | The core: a blue halo behind it, a dial of 144 fine ticks round an outer ring of light with four notches, 24 arc segments with hot centres inside it, a thin inner ring round a glass disc lit from inside (fine rings, a sheen, a ring of printed words), the Ethereum mark in wireframe (near-black facets edged in hot lines), and two broken orbit rings. | `glass`, `collar`: the inner and outer rings' radii in px. It fills its parent and centres there. `dark`: every line at 8 %, the mark hidden. `swell()`, `coin()`, `ignite(): Promise<void>`. | The orbit rings turn slowly in opposite directions, each its own HTML layer so the compositor turns it. `ignite()`: the segments light clockwise from 12 o'clock 20 ms apart, then the rings, then the mark (~900 ms, boot). `swell()`: a copy of the outer ring grows to 1.18 and fades while the segments bloom once (a transaction landed, a block sealed). `coin()`: the mark turns once on its upright axis, 900 ms (a launch). |
| `<egb-port>` | A player's node in a top corner: a socket of seat-colour light inside a dial of fine ticks, holding the badge's blockie as an LED grid, the name, a mono balance with an `EGB` label, and a seat-colour underline with a lit lead, ending in a tick. Empty: the socket at 25 % and `TAP BADGE`. | `seat` (`0` reads rightwards from its socket; `1` mirrors it). `compact`: drawn at 70 % from its top outer corner (the in-game overlay). `key` (`A`/`L`, Demo mode): a key hint, and hover lifts the socket. `bot`: a `BOT` tag. `set(seat: SeatState)`, `pulse()`, `refuse()`. Designed at 380 × 96; the socket's centre is 52 px in from the outer side, halfway down. | A badge arriving rezzes the socket and name; leaving derezzes the name and dims the socket. Changed balance digits flicker in left to right. `pulse()`: the socket's bloom flashes (a tap). `refuse()`: the module shakes and the socket flashes red (a tap that meant nothing). |
| `<egb-clock>` | The block readout: four corner brackets round `BLOCK` and the head block in glowing mono, `SEPOLIA` under them. | `block` (number). Designed at 276 × 64. | Changed digits flicker in, 60 ms apart. |
| `<egb-gauge>` | Gas as a bar: 16 segments of system light for 0–5 gwei (one colour, so never a seat's), a mono `1.8 GWEI` under it. | `gwei` (number). Designed at 88 × 48. | The segments that change switch one at a time from the old end toward the new, 30 ms apart. |
| `<egb-fact>` | A data tag about the focused game: a chamfered frame at idle brightness round a line icon and a word. | `icon`: `players`, `clock`, `coin` or `shield`. Text: the word. `rez(delayMs)`. 44 px tall, width from the word. | `rez()`: after the delay the tag rezzes in (Home rezzes each in turn on a new focus). |
| `<egb-key>` | A light key: a chamfered frame round a dark face and a Syncopate label at 0.36 × its height, shrunk to fit its width. A real `<button>` inside. | `variant` (`primary` default, `ghost`, `alert`), `selected` (filled solid with light: the chosen stake), `breathe`, `disabled`. Text: the label. Dispatches a normal `click`. `flash()`. Fills its box. | A press flashes the shape white and squeezes it to 0.97. `breathe`: the bloom breathes 0.35 ↔ 1 over 2.4 s (`TAP TO START`; 0.7 under reduced motion). |
| `<egb-cart>` | A game's program in the rack: a chamfered glass frame with a header (`PRG 01` and three status lights), an art window lit from below with a faint grid and the game's art in light lines (Quick Draw: a hot bolt and sparks; Stock Duel: orange and cyan candlesticks; `new-game`, the Box's blank program: a dashed frame and a plus; a built game: its `icon` filling the window, held still), the title in Syncopate under it. A game without art is sealed: the window hatched, the title dim, a `SOON` tag (`SEALED` for a built game that can't load). | `game` (`quick-draw`, `stock-duel`, `bet-on-x`, `b17`, `new-game`, or a built game's id), `title`, `icon` (a built game's art URL, set as an image's `src`), `sealed`, `slot` (its number in the rack), `focused`, `pressed`. A strip of light runs along its foot and its reflection lies on the floor (`-webkit-box-reflect`, static). Designed at 176 × 186. | `focused`: it lifts 12 px on a spring and only then lights its frame (a sealed one to 50 %), its status lights, its foot strip, a hot foot bar and its title. Losing focus it drops and dims. `pressed`: the frame flashes white and it settles 6 px (launch). |
| `<egb-txbar>` | The transaction strip: a panel-style frame, the kind and amount (`FAUCET +100 EGB`, `STAKE 2×10 EGB`, `PAYOUT 20 EGB`, `REFUND 10 EGB`) beside the hash (or `SIMULATED`), and the steps `SIGNED › SENT › IN BLOCK n › PAID`. | `show(tx: Tx)`, `hide()`. Designed at 380 × 52. | `show()` on a hidden strip rezzes it; each step lights in system light when reached, and the one just reached flickers once. `hide()` derezzes it. |
| `<egb-panel>` | A panel of light: a chamfered frame at 45 % with hot ticks on its uncut corners round a nearly opaque dark fill. The page plates, the in-game stake chip, the Demo intro, the brief's fields, `SIMULATED` on a sim build. | Its children are its content; sizes from `font-size`. `lit`: the line full with its bloom and the text glowing (the Designer's question in the brief). `--frame-tone` and `--panel-line` (the line's opacity) restyle it. | Never by itself. |
| `<egb-lcd>` | A log of light: a chamfered glass panel of mono lines in system light, the newest at its foot bright and glowing, the older dimmer above it, the oldest going under a dark band at the top; lines wrap. The agent's words while a game builds, the Designer's status and captions. | `caret` (a blinking block cursor: the machine is working). `push(text, mark?)` (`bad` red, `ok` hot white), `set(lines)`, `clear()`. Fills its box; `font-size` sets the text. | `push`: the lines step up by the new one's height as it fades in. The caret blinks by opacity. |
| `<egb-seg>` | A number readout: mono digits glowing over a row of unlit ghost `8`s, so a short value still shows the readout's width. The Build screen's clock, and a built game's scores and timers. | `tone` (`sys` default, `p1`, `p2`, or `amber` / `mint` for a game's own look), `digits` (the fewest cells; the value is right-aligned), `value` (attribute or property). `font-size` is the digits' height. | Changed characters flicker in, left to right. |

Modules go with them, each pure one tested:

- `parts/blockie.ts`: the classic ethereum-blockies identicon for an address. `blockie(address)` gives its colours and
  8 × 8 cells; `blockieLedSvg(address, size)` draws it as an LED grid whose LEDs a caller lights in the seat's colour
  (`.c0` off, `.c1` colour, `.c2` spot).
- `parts/frame.ts`: `framePoints`, `tickPath` and `chamferClip`, the frame's geometry.
- `parts/digits.ts`: `changedDigits(prev, next)`, which characters of a number changed (lined up from the right), and
  `setDigits`, which flickers them in.
- `parts/gas-level.ts`: `litSegments(gwei)`, how many of the 16 gas segments light.
- `parts/eth-mark.ts`: `ethMarkSvg()`, the real six-facet Ethereum mark in wireframe, as an SVG string.
- `parts/still-icon.ts`: `stillIcon(url)`, a built game's icon.svg with its CSS animations and SMIL elements stopped,
  as a data URL. An animated SVG in an `<img>` repaints its program every frame, which held Home to 20–30 fps on the
  Pi. The program falls back to the icon as it is if the still can't be made.

## Shell

`shell/` holds the machinery that places, scales and moves the Box's objects.

- `layout.ts`: every anchor in stage pixels, for the 1280×800 landscape stage and the 720×1080 portrait one (core,
  horizon, ports, clock, gas, title, facts, Play, the four rack slots, the transaction strip). Everything else places
  itself from these, so traces always land on the parts they feed.
- `stage.ts`: `fit(layout, w, h)` scales and centres the stage in the space it gets; `createStage`, `applyFit`.
  Tested in `stage.test.ts`.
- `route.ts`, `traces.ts`: pure geometry. 45° routing, buses, sampling and clipping; `tracesFor(layout)` gives the
  named traces (`port0`, `port1`, `clock`, `slot0`–`slot3`) and the side bundles, in their light's colours. Tested.
- `grid.ts`: `drawGrid(layout, scale)` draws the static Grid once per layout and pixel size and caches it: a sky lit
  from the horizon with faint cloud banks, two ranges of ridges with lit crests and a far city (seeded, so every Box
  draws the same scenery), the glossy floor and its perspective grid fading into haze, the core's and the city's
  light streaked down the floor and a pool under each rack slot, the horizon with its flare, every trace as an
  unpowered light line sunk in a dark channel with lit terminal bars, the HUD's corner brackets and side rulers, a
  vignette and a fine grain. `drawTraces` and `glowOf` (white light blooms blue) are shared with the packets.
- `packets.ts`: a live canvas over the Grid. `run(trace)` sends a hot head along a trace, leaving a trail in its colour
  that fades over 500 ms; it resolves when the head lands. `light(trace)` lights the focused program's feed (a cached
  layer); `flare()` flashes every trace once (a launch); `ambient(on)` sends a lone packet along a side trace every
  7 s ± 2 s (attract only). It draws only while something is in flight.
- `rez.ts`: `rez(node, { delay })` and `derez(node)`, the launcher's entrance and exit (transform and opacity only,
  a short fade under reduced motion), `flicker(node)` and the flicker budget (three a second at most). The keyframes
  are pure and tested in `rez.test.ts`.
- `machine.ts`: the objects that stay across views (Grid, packets, core, ports, clock, gas bar, transaction strip,
  the in-game stake chip) and the `Machine` API views use: `pose` (`home`, `page`, `game`, and `full`
  for a game that draws the whole stage, its top band included, with none of the machine showing), `coin` (the core turns and
  every trace flares), `feed`, `run` (a packet along a named trace, into the core or out of it) and `swell`. It turns transaction steps into moments: a packet from the port when a stake is sent,
  a swell when it lands in a block, a packet out to the port for a payout. It shakes a port on a refused tap and runs
  attract's ambience.
- `router.ts`: mounts the view for the Box's phase; the old view derezzes and the new one rezzes. A move that a newer
  one or a rebuilt stage overtakes never mounts.
- `boot.ts`: one step at a time, about 4 s: the void, the horizon drawn out from under the core, the core igniting,
  the Grid powering on outward, a white packet out along every named trace, then the ports, clock and gas bar rezzing
  120 ms apart.
- `app.ts`: the screen area (the whole window), the stage, the machine and the router; rebuilds the stage when the
  window turns between landscape and portrait. A Box server that restarts and comes back in `boot` under a screen that
  has already booted is sent `booted` at once. With `onSeatTap` (Demo mode) a touch on a `data-seat` element (a port,
  a seat panel) taps that seat, and in a game a touch below the overlay taps the half it lands in, with a ring of that
  seat's light. `isBot` tags the bot's port.
- `sound.ts`: synthesized WebAudio cues, muted by localStorage `gamebox-muted=1`.
- `dom.ts`: `el`, `place`, `play` (a Web Animation; under reduced motion a 160 ms fade to its end state), `fitFont`,
  `fitWidth`, `facesReady`, `wait`, `calm`.

## Link

`link/` holds the two `BoxLink`s. `main.ts` picks one by the build's mode: `VITE_EGB_MODE=demo` (the default, `pnpm
build`) runs `SimLink`; `box` (`pnpm build:box`, for the Pi's kiosk) runs `LiveLink` to the Box server that served
the page, at `/link` on the same origin. Views read the Box's clock from `link.now()`, never `Date.now()`: on
`SimLink` they are the same clock; on `LiveLink` it is the screen's clock plus the link's offset.

| Module | What it is | API |
|---|---|---|
| `sim.ts` | `SimLink`: the core (`src/core/`) in the browser, on the browser's clock, a ledger in memory and the team games, with the bot on Player 2. The screen and the A / L keys tap with a whole tap at once (touch, then done with a fresh roll). | `createSimLink({ seed? }): SimLink` |
| `control.ts` | `SimControl`, what Demo mode drives and BoxLink doesn't have: tap a seat, the opponent switch, the power cut. `SimLink = BoxLink & SimControl`. | types |
| `live.ts` | `LiveLink`: BoxLink over the WebSocket. The whole state on connect, then each event in order; a `state` message after the first is the stations moving (`stations` event). Commands go up only while connected. Reconnects after 250 ms, doubling to 4 s, and starts over from the whole state (an `init` event). | `connectLive({ url, socket?, localNow? }): Promise<LiveLink>` (resolves on the first state) |
| `offset.ts` | The link's clock offset: the largest `boxNow − localNow` of the last 10 s (a message only ever arrives late). | `createClockOffset()` |
| `reuse.ts` | Structural sharing: every part of a new state equal to the last one's keeps the last one's object, so views that compare by identity behave as on `SimLink`. | `reuse(prev, next)` |

## Views

`views/` are the screens the router mounts. Each is a `ViewFactory` (`view.ts`): it draws from `BoxState`, animates
on `BoxEvent`s and acts only through `link.send`.

- `routes.ts`: phase → view and pose (`build` → the game builder; a built game's match → its frame, `frame/`; a Stock
  Duel match → its screen in the `full` pose, since it draws its own players, score and pot).
- `attract.ts`: the Box's name, then the programs rezzing left to right, then `TAP TO START`, which then breathes.
- `home.ts`: the focused game's title, its facts and Play, and the rack (`rack.ts`). Touch or arrow keys focus: the
  old program drops and dims, the new one lifts and lights, a packet runs along its feed into the core, the title
  derezzes and rezzes, the facts rez in turn and the `tick` plays. Enter or Play launches: the key and program flash,
  the core turns and every trace flares. On the Box (`build:box`) the rack ends in the blank NEW GAME program: it
  focuses like a game, on the screen alone (the Box's focus is always a game), and its key, DESIGN, sends `build`.
  Built games' programs stand before it with their art from the Box; one that can't load is sealed, and focusing it
  shows SEALED and why under the title. When the library changes (a `games` event) the rack is built again, and a
  game installed since Home last stood rezzes in where it stands.
- `rack.ts`: the rack's entries (`rackOf(games)`: each game's program, then NEW GAME where the Box has the builder)
  and where each stands (`rackSlots`: the layout's slots, each fed by a trace, then on along the row; a row too long
  for the stage closes up to fit, as in portrait, where the programs past the fourth then stand off the traces).
- `join.ts`, `stake.ts`, `result.ts`, `refund.ts`: pages round the core (`page-layout.ts`), each with a seat panel
  per player (`seat-panel.ts`: a seat-colour frame lit when the seat is asked to act or wins, dimmed to 40 % on a
  loss, `NEEDS n EGB` in red), a panel under the core and keys at the bottom. Result's banner is the winner's colour
  (a draw in system light). Refund's panel is red, and its `REFUND ALL` key (an `alert` key, once the stakes unlock)
  sends every refund still owed, so the Box never waits on a player who walked away. Result says `VOID` when a built
  game's rules failed and both stakes went back.
- Game screens live with their games in `src/games/<game>/screen.ts`; a built game's screen runs in the sandboxed
  frame (`frame/`, its own README), which gives it `<egb-key>`, `<egb-fact>`, `<egb-seg>` and `<egb-plate>` (a panel,
  lit unless `metal`; a `metal` key draws as `ghost`, so games written before the Grid keep working).

## The game builder

The Box's `build` phase (the box build only): the Designer and the Build screen, talking to the server's builder
routes (`server/README.md`) with the launcher token, and following its event stream. Both wear the Grid.

| Module | What it is |
|---|---|
| `views/builder.ts` | The routed view: holds the stream (`hello`, then `designer` and `forge` events; it reconnects and starts over), shows the Designer or the Build screen and moves between them by derez and rez, setting the machine's pose (`page` for the Designer, `home` for a build). A newly queued build takes the screen at once. On entering, a design left half-way is picked up; one already built (the newest job is that brief, done), or none, starts afresh. While the player works and while a build streams in it sends `build`, so the Box only times out back to Home when the builder is left alone. |
| `views/designer.ts` | The Designer on a page round the dimmed core: the step's name and its question (as big as fits) on the left, the step's keys under it; the brief on the right; the status log under the core (the model reading, what was heard, a refusal in the Box's words); along the bottom HOME and BACK (ghost keys), a big typed-answer field with SEND (Enter sends), and HOLD TO TALK (lit while it listens). A refusal goes on the log; a `stale` design is fetched again. Locked while a build runs; BUILD stays dark when the provider can't build here. |
| `views/build.ts` | The World Computer making the game, on the whole lit Grid: the kicker (`BUILDING`, `CHECKING`, `READY TO PLAY`, `DIDN'T BUILD`) with a `SIMULATED` panel for a sim build, the title, the step at work and a mono elapsed clock (`<egb-seg>`); the agent's words on a log; the brief on the right; the four compile checks (manifest, type check, bundle, icon) standing where the rack's programs do. The result: `HOME`, or the error and `DESIGNER` (the brief is kept) and `HOME`. |
| `views/brief-plates.ts` | The brief as panels of light, one per field: at rest once settled, lit for the question asked, faint while open. Says which fields filled. |
| `views/builder-layout.ts` | Where the builder's pieces stand, landscape and portrait; a compile check's place in a rack slot. |
| `views/builder-link.ts` | The page's line to the builder: takes the launcher token from its meta tag at load (and removes the tag), sends it on the builder's routes only; `getJson`, `postJson`, `postBytes`, `getBytes`, `BuilderError` (status, the Designer's code, the Box's words); `openBuilderStream` (a fetch read frame by frame by `server/builder-frames.ts`, the reader the server's tests use too, since EventSource can't send a header; reconnects 0.5 s doubling to 4 s). The test page uses it too. |
| `views/builder.css` | Every style above. |

How it moves:

- **Designer.** A new question's keys rez in one after another. A field that fills flickers its panel and runs a
  packet up a program's feed into the core, which swells. While the model reads an answer the log's cursor blinks and
  a packet runs down the clock's feed into the core every 1.1 s; when it lands, the log says whether it got anything.
- **Build.** Each tool call the agent makes runs a packet of the system's light into the core along its kind of work's
  trace (never a seat's colour, which would say a player did it): reading and searching down Player 1's trace, writing
  and editing down Player 2's, the build check down the clock's feed; one packet a trace at a time, so a burst stays
  readable. A failed tool call runs a red packet out of the core. A build check sets every compile check checking (its
  frame up, its lamp breathing); each check that lands lights its frame with its bloom, or turns it red, flickers it,
  and runs a packet up its slot's trace. The result turns the core once (a game loaded) and rezzes the keys in. Events
  older than two seconds are a replay (a screen that came in late): they set the end state without a moment.
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

`demo/` is what Demo mode adds to the screen, which then stands in for the tap stations a browser doesn't have.

| Module | What it is | API |
|---|---|---|
| `demo-tag.ts` | The DEMO tag, always visible, fixed to the window's bottom-right corner: a small chamfered panel reading `DEMO` (or `POWER CUT`, with a red lamp) and a chevron. A tap or Enter rezzes a panel up out of it with `CUT POWER` (a light switch, `sim.setPower`), `OPPONENT` (`VS BOT \| HOT SEAT`, `sim.setOpponent`) and `SOUND` (a switch, `sound.setMuted`). A tap outside, Escape or the chevron derezzes it. It keeps in step with `sim.subscribe`, and its pointer and key events never reach the stage. | `mountDemoTag(host, sim, sound)` |
| `intro.ts` | The one-time intro: a panel that rezzes in once the boot has finished. `DEMO`, `TWO WAYS TO TAP`, how to tap (a player's frame, or their half of the screen in a game; A and L) and where the DEMO tag's switches are, with an OK key. OK or Escape dismisses it for good (localStorage `gamebox-intro=2`). | `showIntroOnce(host, link)` |
| `keys.ts` | A taps Player 1, L taps Player 2, in the demo only (the Box has real stations). Held keys, modifier shortcuts and typing in a field don't tap. | `bindTapKeys(sim): () => void` |
| `demo.css` | The tag's and the intro's styles. | |

Taps on the screen themselves are the app's (`shell/app.ts`, `onSeatTap`); `main.ts` passes `sim.tap` in Demo mode
only, so in box mode the real stations are the only taps. The simulated Box's hardware side is `SimControl`
(`link/control.ts`). The demo draws no stations: what a station shows (`StationView`, `@egb/sdk`) is the core's,
for the real stations' OLEDs.

`shell/sound.ts` (`createSound(): Sound`) goes with it: every `Cue` synthesized with WebAudio. The launcher's lean
toward a dark analogue synth: boot three detuned saws under a low-pass that opens over 1.6 s with a high shimmer, tap
a short gliding square, block a low sine with a click, error a doubled saw buzz, win a saw arpeggio up to E5, lose a
falling saw pair. The games' seal (a warm chime), flip (a card flick) and tick (a wood tick) are their own. The
AudioContext is made on the first user gesture; until then, and while muted, cues are silent. Muting is remembered
(localStorage `gamebox-muted=1`). It never throws.

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
  from `startedAt` and the Box's clock (`link.now()`), so it never gives away when the draw comes. A remounted view
  picks the dimming up where it has got to.
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
plays. It draws from `state.match.play` (game `stock-duel`) on the whole stage, in its own look, the Slab: a dark
room with each player's colour pooling up from their side, thick graphite slabs lit from above, chunky Unbounded
type, and the seat colours as fills and rims; no theme, no lines or grid. Its route takes the `full` pose, so the
game draws the top band itself: each player's slab (the badge's name, or `PLAYER n`, the stake in USDC and a pip per
round to win), the round and the pot. Each orientation has its own geometry table in `screen.ts`: landscape stands a
Rolodex down each side with the tray between them (the stat wheel over the two wells); portrait puts the Rolodexes
side by side under the band and the tray along the bottom. The comp it was built to is in
`games/stock-duel/look/` (see the blueprint).

| Module | What it is | API |
|---|---|---|
| `screen.ts` | The view: places the parts, draws a state as it stands when it mounts, animates each change after that, runs the drums' frame loop only during the pick, and keeps the band's players and stakes current. | `stockDuelScreen: ViewFactory` |
| `scene.ts` | The room, drawn once in CSS: the dark backdrop lit faintly from above, each seat's colour pooling up from its side (a brighter copy fades in for its moments), and the raised tray in the middle. | `createScene(places): { el, flare(seat, holdMs), hold(seat \| null) }` |
| `rolodex.ts` | One hand as a Rolodex: graphite cards upright on a drum with seat-colour end caps, over a foot. Every card has an index tab in the stock's colour at its own place across the top, so all the hand's tickers show; each card further back stands higher, a little smaller and darker. The front card shows the stock's colour along its top, the ticker and name, four hidden stats and a `?` the draining ring runs round; a rim in the seat's colour lights it while its player picks. The plinth's pill says `TAP TO PLAY`, `LAST TURN` (lit, breathing) or `CARD DOWN`. | `createRolodex(seat, placement, sound): { el, show(hand, front, animate, played), turnTo(front), drain(share), deal(hand, front, delays), lift(card): Rect, note(text, tone), dispose() }` |
| `dial.ts` | The stat wheel: a dark disc of four graphite quarters (`PRICE`, `AVG PRICE`, `24H MOVE`, `LIQUIDITY` in roll order, clockwise from the top left), each named beside it, and a white pointer round a hub. At rest the hub shows `?` and a line under the wheel says how the stat is picked. | `createDial(centre, radius): { el, spin(stat, elapsedMs): Promise<void>, show(stat), rest(), dispose() }` |
| `reveal.ts` | The played cards on the tray: a dark well per seat (it says `LAST TURN` while its seat is on its last turn); face down, a slab in the seat's colour with a big `?` (and `AUTO` when the card was played for the player); face up, the stock's colour across the top with the ticker and company, the round's stat large and the other three below. The winner's card lifts with a seat-colour rim and a `+1 ROUND` badge, the loser's sinks and dims; the line under the cards names who took it, or `TIE · REPLAY`, and during the next pick recalls the last round. | `createReveal(places, label): { el, place(seat, auto, from), waiting(seat, on), flip(record, animate): Promise<void>, recall(record, play), clear(animate), dispose() }` |
| `score.ts` | The band: a slab per player (a seat-colour square with `P1`/`P2`, the name, the stake, the pips), the round and the pot between them, and the end slab over the wheel. A player's square pops when their tap lands; a refused tap shakes their slab. | `createStanding(places): { els, players(players, stake), set(score, round, animate), finish(winner, animate), tap(seat, accepted) }` |
| `stock-duel.css` | All its styles, imported by `screen.ts`. | |

How it moves:

- **Deal**: the cards drop onto each drum one at a time, the two drums half a beat apart, the front card last; each
  lands with a `tick`. Nothing is ever laid out on the tray.
- **Pick**: a frame loop (only in this phase) reads `frontIndex` and `frontRemainingMs` at the Box's clock
  (`link.now()`). When the front card changes the drum indexes one card: the old front card rises and tips back over
  the top of the drum (rotateX about its foot, edge-on at the midpoint), then stands up again at the back while the
  others step forward; it always ends upright. While a chip on the reader is still rolling, its seat's front card is
  held (the rules' `held`): the drum stays on it and its ring stops. The ring drains with transforms only (two half
  rings turning in clipped windows). A played card lifts off the drum and flies face down into its well, the cards
  behind it step forward, and that seat's glow flares. Once one seat has played, the other's plinth reads `LAST TURN`
  and so does its well.
- **Dial**: the wheel wakes (the hub's `?` and the hint go), the pointer spins three turns, swings a few degrees past
  the stat and settles on it; then its quarter lights white and its name is underlined. A screen joining mid-spin
  carries on from where the spin has got to.
- **Reveal**: both cards turn over together (rotateY); then the winner's card lifts on a spring with its rim and
  badge, the loser's sinks and tilts, the result line pops in, the winner's pip lights with a pop and its glow
  flares; a tie moves neither card and says `TIE · REPLAY`. The next pick clears the tray, the line recalls the round
  just played, and the drums close up round the cards that are left.
- **Over**: the final reveal stays, the end slab (`NOVA WINS` in the winner's colour, or `A DRAW`) drops in over the
  wheel, the round reads `FINAL`, and the winner's glow stays bright.
- Sounds: the Box cues `tick` on each drum step, `flip` at the reveal and `seal` when a round scores; the screen adds
  only the deal's `tick`s.
- Only transform and opacity animate; every shadow and glow is static and reaches at most 24 px. Each card's shade
  keeps a layer of its own, and the front card's rim is one layer that stays put while the cards turn under it, so a
  drum step never rasters a card's shadow again. Under reduced motion it shows end states: the drum jumps to the next
  card, cards appear in their wells, the pointer is already on the stat, the faces and the outcome are already shown.
