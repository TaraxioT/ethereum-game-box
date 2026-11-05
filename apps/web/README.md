# apps/web

`@egb/web`: the public site on Cloudflare. It reads ENS and the contracts directly with viem and has no backend or
database of its own.

## What goes here

| Path | Holds |
|---|---|
| `src/pages/boxes` | Every Box under `gamebox.eth`: its status, last seen, current game |
| `src/pages/players` | Player names and the stats the games write to them |
| `src/pages/champion` | Who holds `champion.stockduel.gamebox.eth` right now, and its history |
| `src/pages/claim` | Claim a player name |
| `src/ens.ts` | The ENS reads (`getEnsAddress`, `getEnsText`), in one place |

## First milestone

The champion page shows the title moving after a real win at the Box.
