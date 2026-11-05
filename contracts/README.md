# contracts

Foundry. Every contract, its tests and its deploy scripts. All of it deploys to Sepolia.

## What goes here

| Folder | Holds |
|---|---|
| `src/box/` | The Box registry (register, rotate, revoke a Box's P-256 key) and P-256 verification with low-s enforced |
| `src/games/` | The game interface and escrow (open, settle, refund), then one contract per game |
| `src/token/` | The Game Box token and its launch through Uniswap's auction |
| `src/hook/` | The Uniswap v4 hook: three fee levels and the time-weighted price |
| `src/staking/` | Staking to a Box, rewards, commission, and the operator auction |
| `src/names/` | ENS names under `gamebox.eth`: Boxes, players, titles |
| `test/` | Forge tests: every rule and every refusal |
| `script/` | Deploy scripts; each writes its addresses to `deployments/sepolia.json` |

## Setup

`forge init` conventions; libraries (`lib/`) are installed, not committed. Sepolia gas estimates run low: deploy with
`cast estimate` plus 50%, or a fixed high `--gas-limit`.
