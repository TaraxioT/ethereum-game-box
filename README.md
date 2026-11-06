# Ethereum Game Box

A game console you play by tapping a badge. Every match is staked and settled on Ethereum, and nobody at the table
needs ETH, a wallet app or a single pop-up.

Built at ETHGlobal Mumbai 2026. The project plan: [`plan/README.md`](plan/README.md), also live at
https://plans.georgekm.com/ethereum-game-box-2026-11-05/.

## Team

[beingentangled](https://github.com/beingentangled) · [saithyasivadas](https://github.com/saithyasivadas) ·
[Athuli7](https://github.com/Athuli7) · [lizgeorge1](https://github.com/lizgeorge1) ·
[0xgeorgemathew](https://github.com/0xgeorgemathew)

## Layout

| Folder | What goes in it |
|---|---|
| [`apps/box`](apps/box/README.md) | The Game Box: the core, the Pi server, the taps, the game builder, the screen and the games |
| [`apps/relayer`](apps/relayer/README.md) | The Cloudflare Worker that pays the gas for signed requests: name claims, Box writes, results, pop-ups |
| [`apps/demo-box`](apps/demo-box/README.md) | A Box with no hardware, as a Cloudflare Worker: a software P-256 key that signs heartbeats and results |
| [`apps/verifier`](apps/verifier/README.md) | The Cloudflare Worker that judges a store game: an agent in a container, 0G's private inference and the verifier key |
| [`apps/web`](apps/web/README.md) | The public site, read straight from ENS and the contracts |
| [`packages/sdk`](packages/sdk/README.md) | `@egb/sdk`: the contract between the Box and its games (rules, station views, manifests, the rules-runner and frame protocols) |
| [`packages/shared`](packages/shared/README.md) | Message digests, the badge entry, ABIs and addresses, shared by every app; `@egb/shared/web` for the sites' browser code |
| [`packages/ui`](packages/ui/README.md) | `@egb/ui`: the sites' Schematic look, element builder, Sepolia tag and transaction strip |
| [`contracts`](contracts/README.md) | Foundry: the registry, games, token, hook, staking and names |
| [`deployments`](deployments/README.md) | Every deployed address, one file per chain |
| [`firmware/tap-station`](firmware/tap-station/README.md) | The ESP32 tap stations and their receiver |
| [`deploy/pi`](deploy/pi/README.md) | Turning a Raspberry Pi into a Game Box, and keeping it updated |
| [`plan`](plan/README.md) | The project plan, as Markdown and as a web page |

## Start

```sh
cp .env.example .env
pnpm install
pnpm typecheck && pnpm test && pnpm contracts:test
pnpm firmware:test
```

The whole Box on a laptop, with simulated stations and badges:

```sh
pnpm --filter @egb/box build:box
EGB_RECEIVER=fake EGB_FORGE_PROVIDER=sim node apps/box/src/server/main.ts   # then open http://127.0.0.1:8790/
```

On the Pi it runs from `deploy/pi/` (see its README); the plan for it is [`plan/box-server.md`](plan/box-server.md).
