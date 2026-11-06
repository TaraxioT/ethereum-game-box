# The Box's parts, by tag

The kiosk loads the Box's parts bundle into your screen's frame before your `screen.js`, so these custom elements
exist when `mount` runs. Create them like any element (`document.createElement("egb-plate")`) and set their text and
attributes. Each draws itself inside its own shadow root in the Box's look, the Grid (thin lines of light on
near-black glass, chamfered corners), and under `prefers-reduced-motion` each shows its end state at once. Use them
for the Box's own kinds of object; draw your game's own world yourself.

| Tag | What it is | Attributes and API |
|---|---|---|
| `<egb-plate>` | A panel of light: a chamfered frame with hot ticks on two corners round dark glass. A title, an instruction, a verdict. | `variant`: `brass` (default: the line lit full, with its bloom, and the text glowing) or `metal` (a quiet line). Its children are its content. Sizes from `font-size`. Never moves. |
| `<egb-key>` | A key of light: a chamfered frame round a wide caps label. | `variant`: `primary` (default; `brass` is the same) for the one main action, `ghost` (`metal` is the same) for a secondary one, `alert` (red) for something going wrong. `selected` (filled with light), `breathe` (its bloom breathes slowly), `disabled`. Text: the label. Fills its box. Flashes when pressed. |
| `<egb-seg>` | A number readout: mono digits glowing over a row of unlit `8`s. Scores, counts, timers. | `tone`: `sys` (default, the Box's white-blue light), `p1` (orange), `p2` (cyan), `amber` or `mint`. `digits`: the fewest cells. `value`: the text (digits, space, `-`, `.`, `,`, `:`), as an attribute or a property. `font-size` is the digits' height. Changed characters flicker in. |
| `<egb-fact>` | A small data tag: a chamfered frame round a line icon and one word. | `icon`: `players`, `clock`, `coin` or `shield`. Text: the word. 44 px tall by default. |

The players never touch your screen: a game is played by tapping badges on the two stations. Keys are for showing
what a tap will do, not for clicking.

## The look

- The Box's world is near-black (`#010409`); its light is a cool white-blue (`#cfe8f6`, a white `#ffffff` core) that
  blooms blue (`#4aa8e8`). Panels are dark blue glass. The parts above already wear this; your game may keep its own
  look round them.
- Player 1 is orange (`#ff9b3d`, light `#ffd2a3`) on the left; Player 2 is cyan (`#3fd9ff`, light `#b5f1ff`) on the
  right. A seat's colour marks what that seat owns; it never paints half the screen. Red (`#ff2d3d`) means something
  went wrong.
- Big words in caps, readable from a step away. Glows are static and short.
- Animate only `transform` and `opacity`; nothing loops forever on screen; at most one `requestAnimationFrame` loop.
