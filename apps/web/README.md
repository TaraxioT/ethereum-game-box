# apps/web

`@egb/web`: the Game Box's public names site, live at **https://gamebox-names.pages.dev**. It shows every ENSv2
feature the Game Box uses, on Sepolia: it reads names through the Universal Resolver with plain viem and writes them
through the relayer. A static site on Cloudflare Pages, with no backend and no database: names are listed from
`GameBoxNames`' events, and every value comes from chain. The RPCs are public Sepolia endpoints with a fallback, so no
key ships in the bundle.

```sh
pnpm --filter @egb/web dev      # http://localhost:5173, with /_relayer and /_demo-box passed through to the Workers
pnpm --filter @egb/web test
pnpm --filter @egb/web deploy   # builds and deploys to the gamebox-names Pages project
```

## What goes here

| Path | Holds |
|---|---|
| `src/ens.ts` | The ENS reads (`getEnsAddress`, `getEnsText`), in one place. A name that doesn't resolve reads as null |
| `src/registry.ts` | Where a name lives in ENSv2: its registry, resolver, expiry, owner, token and emancipation |
| `src/answer.ts` | Which resolver answered a name, and why: its own record, a linked record (a pop-up uses its Box's), or a parent's default record by wildcard |
| `src/kinds.ts` | Each account's kind: a `P256Account` (its factory maps its key back to it), an EOA, or another contract |
| `src/watch.ts` | The record watch: a key's value on a Box and its pop-ups at each block, and its last `TextUpdated` |
| `src/access.ts` | The role table (`roles`, `hasRoles`, decoded with the role names) and the Try grid (`eth_call` per account and key) |
| `src/errors.ts` | Reverts decoded to their error names, from every names ABI |
| `src/directory.ts` | Every Box, pop-up, player, game and crowning, from `GameBoxNames`' events, read in chunks from its deploy block |
| `src/model.ts` | What each kind of name reads as, and the accounts and keys its inspector shows |
| `src/actions.ts` | The writes: claim, primary name, drip, revoke, open a pop-up, report a match; and the title's transfer, tried |
| `src/badge.ts` | The badge: an injected wallet, or a test badge (a key kept in this browser) |
| `src/relayer.ts` | The relayer and demo Box over HTTP, with the types from `@egb/shared/names` |
| `src/txs.ts` | Every write's progress for the transaction strip, relayed (`/tx/:id`) or direct (the receipt) |
| `src/story.ts`, `src/story-steps.ts` | The Story's step machine, and its seven steps |
| `src/pages/` | The tree (home), Boxes, Players (with the claim), Champions, Agent, and the inspector |
| `src/ui/` | The element builder, live countdowns, the Sepolia tag, the transaction strip, the Try grid, the Story rail, the resolver answer, the record watch and the QR code |
| `src/config.ts` | The RPCs, the relayer, the demo Box, the operator site (`https://gamebox-operator.pages.dev`) and the ENS app |
| `src/site.css` | The look: the Box's Grid as a document. Tokens and fonts come from `@egb/box` |

## The look

The Box's Grid (palette, faces, light lines), imported from `@egb/box/tokens.css` and `@egb/box/fonts.css`, on a quiet
void with a faint graph-paper grid. A numbered Story rail on the left, the tree as an indented outline with the
brief's words as margin notes, the inspector as a page of its own, and the Try grid lighting the cells the chain
allows. On a phone the rail folds to the current step pinned at the top, and the margin notes sit under their rows.

## Where the operator works

Operators manage their Box on the operator site, a separate app (`apps/operator`), with a passkey. This site links to
it from every Box and pop-up and watches the chain for its writes: the record watch shows `location` on `mumbai-01`
and its pop-ups change at the same block. The URL lives in `src/config.ts` (`VITE_OPERATOR_SITE_URL` overrides it).

After a claim, the name's QR code opens it in the ENS app on Sepolia (`sepolia.app.ens.domains`), which resolves
through ENSv2 and shows the names under `gamebox.eth`.

## Rules

- Every digest, ABI, key, label rule and address comes from `@egb/shared/names`; nothing here writes its own.
- Nothing is cached between reads but the event list, so an expired name never shows a stale value.
- The relayer's CORS allows only `https://gamebox-names.pages.dev`; the dev server passes requests through instead.
