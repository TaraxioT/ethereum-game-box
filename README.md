# Ethereum Game Box

A game console you play by tapping a badge. Every match is staked and settled on Ethereum, and nobody at the table
needs ETH, a wallet app or a single pop-up.

Built at ETHGlobal Mumbai 2026. The project plan: [`plan/index.html`](plan/index.html), also live at
https://plans.georgekm.com/ethereum-game-box-2026-11-05/.

## Team

[beingentangled](https://github.com/beingentangled) · [saithyasivadas](https://github.com/saithyasivadas) ·
[Athuli7](https://github.com/Athuli7) · [lizgeorge1](https://github.com/lizgeorge1) ·
[0xgeorgemathew](https://github.com/0xgeorgemathew)

## Layout

| Folder | What goes in it |
|---|---|
| [`apps/box`](apps/box/README.md) | The Game Box: the Pi server, the screen, the games and the Box key |
| [`apps/relayer`](apps/relayer/README.md) | The Cloudflare Worker that pays gas for Box-signed requests |
| [`apps/web`](apps/web/README.md) | The public site, read straight from ENS and the contracts |
| [`packages/shared`](packages/shared/README.md) | Message digests, the badge entry, ABIs and addresses, shared by every app |
| [`contracts`](contracts/README.md) | Foundry: the registry, games, token, hook, staking and names |
| [`deployments`](deployments/README.md) | Every deployed address, one file per chain |
| [`firmware/tap-station`](firmware/tap-station/README.md) | The ESP32 tap stations and their receiver |
| [`deploy/pi`](deploy/pi/README.md) | Turning a Raspberry Pi into a Game Box, and keeping it updated |
| [`plan`](plan/index.html) | The project plan page |

## Start

```sh
cp .env.example .env
pnpm install
pnpm typecheck && pnpm test && pnpm contracts:test
```
