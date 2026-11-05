# The Box's parts, by tag

The kiosk loads the Box's parts bundle into your screen's frame before your `screen.js`, so these custom elements
exist when `mount` runs. Create them like any element (`document.createElement("egb-plate")`) and set their text and
attributes. Each draws itself inside its own shadow root in the Box's look (gunmetal, brass, neon, one key light from
the top left), and under `prefers-reduced-motion` each shows its end state at once. Use them for the Box's own kinds
of object; draw your game's own world yourself.

| Tag | What it is | Attributes and API |
|---|---|---|
| `<egb-plate>` | An engraved plate with a screw in each corner: a title, an instruction, a verdict. | `variant`: `brass` (default) or `metal`. Its children are its content. Sizes from `font-size`. Never moves. |
| `<egb-key>` | A physical key: `brass` for the one primary action, `metal` for a secondary one. | `variant`, `breathe` (a slow gold light round it), `disabled`. Text: the label. Fills its box. Travels down when pressed. |
| `<egb-seg>` | A seven-segment LCD readout with its unlit segments showing: scores, counts, timers. | `tone`: `amber` (default) or `mint`. `digits`: the fewest cells. `value`: the text (digits, `.`, `,`). `font-size` is the cell height. Changed digits roll in turn. |
| `<egb-fact>` | A fact as an IC chip: a dark epoxy body with silver pins and one word in silkscreen. | `icon`: `players`, `clock`, `coin` or `shield`. Text: the word. Height from its box (44 px by default). |

The players never touch your screen: a game is played by tapping badges on the two stations. Keys are for showing
what a tap will do, not for clicking.

## The look

- The room is a deep violet-black (`#120c24`), plates `#2d2356` to `#211943`, ink `#07040f`.
- Player 1 is orange (`#ff9b3d`, light `#ffd2a3`) on the left; Player 2 is cyan (`#3fd9ff`, light `#b5f1ff`) on the
  right. A seat's colour marks what that seat owns; it never paints half the screen.
- Neon accents: lavender `#ad8fff`, marigold `#ffc46b`, mint `#86eec4`.
- Big words in caps, readable from a step away. Glows stay on their edges.
- Animate only `transform` and `opacity`; nothing loops forever on screen; at most one `requestAnimationFrame` loop.
