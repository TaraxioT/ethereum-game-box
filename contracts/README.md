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

`forge init` conventions; libraries (`lib/`) are installed, not committed: `pnpm contracts:install`.

Sepolia gas estimates run low: forge's local simulation priced the GBX deploy at about 584k gas, and Sepolia charged
3.71M. Check the real cost with `cast estimate --create`, and raise forge's estimate with `--gas-estimate-multiplier`
until it covers that. GBX deployed with 800.

Deploy (from `contracts/`, with `ALCHEMY_API_KEY` exported):

```sh
forge script script/DeployGBX.s.sol --rpc-url sepolia --account sepolia-deployer --gas-estimate-multiplier 800 --broadcast
```

Scripts write each address into `deployments/sepolia.json` and refuse to on any chain but Sepolia. Addresses we use
but don't deploy (USDC) sit under `external`.
