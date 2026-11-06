# packages/ui

`@egb/ui`: the DOM side the Game Box sites share (`apps/web`, the names site, and `apps/operator`): the Schematic look,
a small element builder, and the Sepolia tag and transaction strip every page has. No UI framework. The browser code
without DOM (the Sepolia client, the head watch, the relayer client, the transaction log) is `@egb/shared/web`.

```sh
pnpm --filter @egb/ui test    # Vitest on happy-dom
pnpm --filter @egb/ui build   # bundles it into dist/, which proves the stylesheet's imports resolve
```

## What goes here

| Export | Holds |
|---|---|
| `@egb/ui/schematic.css` | The look: the Box's Grid tokens and fonts (imported from `@egb/box`, never copied), the void with its graph-paper grid, the header and Sepolia tag, keys, type and tones, cards, the fact grid (`.dl`), tables (`.roles`), panels and form rows, and the transaction strip, down to phone width. A site imports it first and adds its own layout |
| `@egb/ui/dom` | `h(spec, attrs, ...children)`, `append`, `short`, `addressLink`, `txLink`, `tag`, `key`, `reading`, `failed`, and `field(label, input, hint)` (a `.form-row`) |
| `@egb/ui/chrome` | `mountChainTag(root, { watch, health, onHealth })`, `txRow(tx)` and `mountTxStrip(root, log)`, drawn from `@egb/shared/web`'s `watchHead` and `txLog` |

## Rules

- Only what both sites draw the same way lives here; a site's own pages and layout stay in the site.
- The Grid's tokens and fonts stay in `apps/box` (the Box's screen is their first user) and come in through its
  `exports`.
