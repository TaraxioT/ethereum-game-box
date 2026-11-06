# contracts

Foundry. Every contract, its tests and its deploy scripts. All of it deploys to Sepolia.

## What goes here

| Folder | Holds |
|---|---|
| `src/box/` | The Box's account (`BoxAccount`), the Box registry (register, rotate, revoke a Box's P-256 key) and P-256 verification with low-s enforced |
| `src/games/` | The game interface and escrow (open, settle, refund), then one contract per game |
| `src/token/` | The Game Box token and its launch through Uniswap's auction |
| `src/hook/` | The Uniswap v4 hook: three fee levels and the time-weighted price |
| `src/staking/` | Staking to a Box, rewards, commission, and the operator auction |
| `src/names/` | ENS names under `gamebox.eth`: Boxes, players, titles |
| `test/` | Forge tests: every rule and every refusal |
| `script/` | Deploy scripts; each writes its addresses to `deployments/sepolia.json` |

## Setup

`forge init` conventions; libraries (`lib/`) are installed, not committed: `pnpm contracts:install`. Sepolia gas
estimates run low (see [Gas on Sepolia](#gas-on-sepolia)): forge priced the GBX deploy at about 584k gas and Sepolia
charged 3.71M, so send with `--skip-simulation -g 150`.

Deploy (from `contracts/`, with `SEPOLIA_RPC_URL` exported):

```sh
forge script script/DeployGBX.s.sol --rpc-url sepolia --account sepolia-deployer --password '' --broadcast \
  --skip-simulation -g 150
```

Scripts write each address into `deployments/sepolia.json` and refuse to on any chain but Sepolia. Addresses we use
but don't deploy (USDC) sit under `external`.

## Names

The Game Box's ENS names live on ENSv2 on Sepolia, under `gamebox.eth`. Our contracts call ENS's own `UserRegistry`
and `PermissionedResolver` implementations through ENS's `VerifiableFactory`, so every registry and resolver we make is
an ENS proxy. `src/names/IENSv2.sol` is the slice of ENSv2 we call; each signature, role bit and error in it is copied
from the source the Sepolia deployment was built from (`ensdomains/contracts-v2`, branch `deploy/mainnet-v2-20261002`).

### Contracts

| Contract | Does |
|---|---|
| `box/P256.sol` | P-256 verification through the EIP-7951 precompile at `0x100`. It refuses a high `s`, and an empty answer (a chain without the precompile) counts as invalid. The digest goes to the precompile as it is: the Box signs the raw 32-byte EIP-712 digest, with no SHA-256 |
| `box/BoxAccount.sol` | A Box's account, bound to one P-256 key. `execute(target, value, data, nonce, deadline, r, s)` runs a call the key signed over EIP-712 `Execute` (domain `Game Box`). Any unused nonce works once. It refuses an expired deadline, a used nonce, a high `s` and a call to itself, and a revert in the target bubbles up |
| `names/GameBoxNames.sol` | The registrar of `gamebox.eth`. Its constructor creates `gamebox.eth`'s `UserRegistry`, the shared title resolver and the shared game resolver. It registers Box licences (`registerBox`, `renewBox`, `setBoxStatus`, `setBoxKey`), player names (`claimPlayer`, with the badge's EIP-712 `ClaimName` consent, ECDSA or ERC-1271), games with their title registries (`addGame`) and champion titles (`crown`) |
| `names/PlayerStats.sol` | Counts wins, losses and draws per player and game, and writes each player's `stats` record. It takes results only from `GameBoxNames`' `REFEREE_ROLE`. A player who revoked its `stats` role (or whose resolver fails) is skipped with `StatsSkipped`, and the opponent's result still settles |
| `names/BoxResults.sol` | The referee for now. `submit(result, r, s)` checks a result signed by a Box's P-256 key over EIP-712 `Result` (domain `Game Box Results`), then crowns the winner and records stats. It refuses an unknown Box, an expired Box, a Box that isn't `active`, a used `(box, round)`, an expired deadline, a player without a name, and `winner == loser` |
| `names/DemoLicences.sol` | A licensor for now. `openPopup(label)` registers `popup-<label>.gamebox.eth` to the demo operator, run by the demo Box, for exactly 10 minutes, for anyone |
| `names/NameLib.sol` | The label rule (3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end) and the DNS-encoded names |

### Names and records

| Name | Expiry | Resolver | Writers |
|---|---|---|---|
| `<box>.gamebox.eth` | its licence | its own | `GameBoxNames`: `addr`, `boxKey`, `status`. Operator: `commission`, `location`, `description`, `games`. Box: `lastSeen`, `game` |
| `popup-<x>.gamebox.eth` | 10 minutes | its own, new for each licence | as above, with the demo Box as the Box |
| `<player>.gamebox.eth` | never (`2^64 − 1`) | its own | badge: every role. `PlayerStats`: `stats` only, until the badge revokes it |
| `bot.gamebox.eth` | never | its own | the agent: every role, and its ENSIP-26 records. `PlayerStats`: `stats` |
| `<game>.gamebox.eth` | never: it lasts as long as `gamebox.eth` | the shared game resolver | `GameBoxNames`: `title`, `titleTerm` |
| `champion.<game>.gamebox.eth` | the term after the last win (7 days for Stock Duel, 15 minutes for Quick Draw) | the shared title resolver | `GameBoxNames`: `addr`, `holder`, `start`, `streak`, `round` |

Each Box and each player has its own resolver, because a `PermissionedResolver` role covers a key on every name the
resolver serves. Game names and titles have separate shared resolvers: when a name has no resolver, the Universal
Resolver falls back to the nearest parent's, so a lapsed title must not fall back to a resolver that still holds its
records.

### Roles

| Where | Who | Holds |
|---|---|---|
| `GameBoxNames` (OpenZeppelin `AccessControl`) | deployer | `DEFAULT_ADMIN_ROLE` (adds games, sets the stats writer) and `LICENSOR_ROLE` |
| | `DemoLicences` | `LICENSOR_ROLE`: issues and manages Box licences |
| | `BoxResults` | `REFEREE_ROLE`: crowns, and is the role `PlayerStats` takes results from |
| `gamebox.eth`'s registry, root | `GameBoxNames` | `REGISTRAR \| RENEW \| SET_PARENT`, and nobody else holds a root role, so it is emancipated |
| a title registry, root | `GameBoxNames` | `REGISTRAR \| UNREGISTER \| RENEW \| SET_PARENT`. Moving a title is unregister + register, so it isn't emancipated |
| a Box name's token | operator | nothing: it can't transfer the name or re-point its resolver or subregistry |
| a player name's token | badge | `UNREGISTER`, `RENEW`, `SET_SUBREGISTRY` and `SET_RESOLVER` with their admins, and `CAN_TRANSFER_ADMIN` |
| a title's token | holder | nothing: a transfer reverts `TransferDisallowed` |
| a Box resolver, root | `GameBoxNames` | `SET_TEXT_ADMIN \| SET_ADDRESS`, kept so it can move the Box's keys to a new account. It only ever grants the eight Box keys |
| a Box resolver, per key | `GameBoxNames`, operator, Box | `SET_TEXT` on its own keys (table above) |
| a player resolver, root | badge | every role and every admin role. `GameBoxNames` holds `SET_TEXT_ADMIN` only inside `claimPlayer`, to grant `stats`, and drops it in the same call |
| a player resolver, `stats` | `PlayerStats` | `SET_TEXT`, until the badge revokes it |
| the title and game resolvers, root | `GameBoxNames` | `SET_TEXT \| SET_ADDRESS`: it is their only writer |

Choices the design left open, made here:

- **A separate game resolver** (`GAME_RESOLVER`), with `title` and `titleTerm` on each game name, so a lapsed title has
  no records to fall back to.
- **Game names never expire** (`2^64 − 1`): a subname can't outlive `gamebox.eth`, so they last exactly as long as it.
- **The licensor's powers:** `renewBox`, `setBoxStatus` and `setBoxKey(label, account, qx, qy)` need `LICENSOR_ROLE`.
  `setBoxKey` takes a new account too, since a `BoxAccount` is bound to one key.
- **A label that is or was a Box can't be claimed as a player name** (`LabelHeldByBox`), so pop-up labels can be
  reused.
- **The Box resolver roles** and **the player roles** in the table above.
- **`PlayerStats` checks `REFEREE_ROLE` on `GameBoxNames`**, so referees are granted in one place. It keeps counting a
  revoked player on chain, and writes `stats` in a caught call capped at 400k gas: a badge controls its resolver and
  could upgrade it to one that burns all its gas. It refuses to start a write without gas for the full cap
  (`InsufficientGas`), so a sender can't force a skip.

### Forward plan

Nothing in this build does it yet. The Box registry and the operator auction take `LICENSOR_ROLE`, and the escrow's
settle takes `REFEREE_ROLE`; `DemoLicences` and `BoxResults` then lose theirs. No name, resolver or `PlayerStats` record
moves. Once `gamebox.eth` is renewed for years, its owner revokes `SET_SUBREGISTRY` on it, which makes "forever" true.
That is irreversible, so it waits for George.

### Primary names

A badge can make `getEnsName(badge)` return its player name. ENS's `DefaultReverseRegistrar` on Sepolia
(`ens.DefaultReverseRegistrar` in `deployments/sepolia.json`) takes the badge's ERC-191 signature from any sender
(`setNameForAddrWithSignature`, expiry at most an hour away). The relayer submits it after the claim, so the badge needs
no ETH (`primaryNameMessage` in `@egb/shared/names`). A badge with ETH can call the `addr.reverse` registrar's
`setName` itself. The Universal Resolver returns the name only if it resolves back to the badge. `PrimaryName.t.sol`
tests both on the fork. `GameBoxNames` doesn't call the reverse registrar: the claim is consent to a name, and the
primary name is a separate, optional consent the badge signs alongside it.

### Gas on Sepolia

Sepolia charges far more than mainnet for new code and storage (about 1,542 gas per byte of new code and 111k per new
storage slot), and forge's local gas estimates don't know that. Send every names script with `--skip-simulation`, so
forge takes `eth_estimateGas` from the node, and `-g 150` for the estimate plus 50%. Measured on Sepolia:

| Action | Creates | Gas | Transaction |
|---|---|---|---|
| deploy `GameBoxNames` | `gamebox.eth`'s registry, the title resolver, the game resolver | 33,473,246 | `0xcfdbc18d…985ce1` |
| deploy `PlayerStats` | | 8,602,979 | `0x66e031ed…9bb1a3` |
| deploy `BoxResults` | | 7,594,889 | `0xe9056c7c…0aada7` |
| deploy `BoxAccount` | | 4,282,300 | `0xf3036a19…b97133` |
| deploy `DemoLicences` | | 3,151,479 | `0x4ae926d9…dcc326` |
| `addGame` | a title registry | 2,109,753 (Stock Duel), 2,122,265 (Quick Draw) | `0xd8135cdb…e7d721`, `0x091e8121…c38c4f` |
| `registerBox` | a Box resolver and its eight grants | 4,649,562 | `0x22862aa5…f50a62` |
| `openPopup` | a Box resolver and its eight grants | 4,772,680 | `0x2e25b1be…c908ab` |
| `claimPlayer` | a player resolver | 2,003,659 | `0xc19d1aad…7569b8` |
| `BoxAccount.execute` (a heartbeat `setText`) | | 280,109 | `0x7a202e5a…cf1f7f` |
| `grantRole` | | 133,549 | `0x5f7ab581…3d81a3` |

### Deploy

From `contracts/`, with the repo `.env` loaded. Each script skips what is already done. A second run of a deploy script
without `--broadcast` records each new contract's block and transaction in `deployments/sepolia.json`.

```sh
F="--rpc-url sepolia --account sepolia-deployer --password '' --broadcast --skip-simulation --slow -g 150 \
  --with-gas-price 2gwei --priority-gas-price 1gwei"
forge script script/names/DeployNames.s.sol $F                    # contracts, roles, the stats writer
forge script script/names/DeployNames.s.sol --rpc-url sepolia --account sepolia-deployer --password ''   # record
forge script script/names/PointGameBox.s.sol $F                   # gamebox.eth -> our registry (its owner only)
forge script script/names/AddGames.s.sol $F                       # stockduel (7 days), quickdraw (15 minutes)
forge script script/names/RegisterBox.s.sol $F                    # mumbai-01 for 30 days, and a demo Box heartbeat
forge script script/names/ClaimAgent.s.sol --sig "claim()" $F     # bot.gamebox.eth, with the agent's signature
G="--rpc-url sepolia --broadcast --skip-simulation -g 150 --with-gas-price 2gwei --priority-gas-price 1gwei"
forge script script/names/OperatorRecords.s.sol $G                # the operator writes its four keys
forge script script/names/ClaimAgent.s.sol --sig "records()" $G   # the agent writes its ENSIP-26 records
```

`DEMO_BOX_P256_KEY`, `DEMO_OPERATOR_KEY` and `AGENT_PRIVATE_KEY` live only in `.env`. The operator and the agent each
need a little ETH for their own writes.

### Verify and check

- `pnpm names:verify` verifies our contracts with `forge verify-contract` (constructor arguments read from the creation
  transaction) and marks them `verified`. Every `VerifiableFactory` proxy is a 77-byte clone of one proxy logic contract
  (`ens.VerifiableProxyLogic`), which was unverified, and Etherscan's proxy verification alone left the proxies without
  source. So the script verifies that logic contract from the source ENS deployed it with: the metadata of ENS's
  `VerifiableFactory` deployment (`verifiable-factory` at `c1090aec`, solc 0.8.25, 1,000 runs) embeds every source
  file. Since then Etherscan shows the source of every clone, current and future. The script then links each proxy
  (found from `GameBoxNames`' events) to its ERC-1967 implementation with `verifyproxycontract`. Etherscan's API reports
  the clones as `Proxy = 2` (a minimal proxy of the logic contract), not `1`. Sourcify wasn't needed. Run it again
  after new claims and licences.
- `pnpm names:check` reads the live deployment and fails on any mismatch: every address has code, every contract and
  proxy is verified, each role table is as above (holders and assignee counts), and every name resolves through the
  Universal Resolver with stock viem.

### Tests

`pnpm contracts:test` runs the names tests on a fork of Sepolia pinned to a block (`SEPOLIA_RPC_URL`), against the live
ENSv2 contracts. Test accounts and labels carry an `egb-test-` or `egbt-` prefix, so they can't collide with live state.
`Vectors.t.sol` writes `packages/shared/src/names/vectors.json`, which the shared package's tests check byte for byte.

## Staking

`staking/BoxStaking.sol` holds GBX staked behind a Box and pays the Box's USDC game fees out to it. A Box is a label in
`GameBoxNames`, so staking reads the Box's operator, status and expiry from there and keeps no registry of its own.

| Rule | |
|---|---|
| Open | The Box is `Active` in `GameBoxNames` and its licence hasn't lapsed. New stake and fees need an open Box; unstaking, withdrawing and claiming always work |
| Bonded | Open, and the operator's own stake is at least `MIN_OPERATOR_STAKE`. Only the operator may stake on a Box that isn't bonded, and only a bonded Box takes fees |
| Shares | Stake is held as shares (with a virtual share and a virtual GBX, so the first staker can't inflate the price), so a slash lowers every staker by the same fraction |
| Unbonding | `requestUnstake` moves stake into a second pool that earns nothing and is still slashed, until `UNSTAKE_DELAY` passes; a second request restarts the delay. While the Box is open the operator can't go below the minimum |
| Rewards | `notifyFees(label, amount)` pulls USDC from the caller: the commission goes to the operator at once, the rest to stakers by a USDC-per-share counter. `claim` pays it out |
| Commission | 10% to 90%, starting at 10%. A cut is immediate; a raise waits `COMMISSION_DELAY`, unless the operator is the only staker |
| Slashing | `slash(label, bps, to)` takes `bps` of the active and the unbonding pool and sends it to `to`. `SLASHER_ROLE` only; nobody holds it until the dispute contract exists |

`stakeFor` lets the lobby and the operator auction stake bought GBX for a player or an operator in one transaction.

Deployed with `MIN_OPERATOR_STAKE` 10,000 GBX and both delays at 1 hour, short enough to show in a demo. The deployer
holds `DEFAULT_ADMIN_ROLE`.

```sh
forge script script/DeployStaking.s.sol --rpc-url sepolia --account sepolia-deployer --password '' --broadcast \
  --skip-simulation -g 150
```

`test/staking/BoxStaking.t.sol` runs on the same Sepolia fork as the names tests, against real USDC and a fresh
`GameBoxNames`. Any archive RPC works as `SEPOLIA_RPC_URL`; the public `https://sepolia.gateway.tenderly.co` does.

## Swap hook

`hook/GameBoxHook.sol` is the Uniswap v4 hook of the GBX/USDC pool (dynamic fee, tick spacing 60). It is the only
pool it serves: `afterInitialize` refuses any other key, and only once.

| Rule | |
|---|---|
| Fee | 1% on a plain swap. 0.25% on a tap swap. 0% for a router with `FEE_EXEMPT_ROLE` (the lobby and the buyback, later) |
| Tap swap | The swap's hook data is a `TapSwapData`: a Box, a badge, a nonce, a deadline and the Box's P-256 signature over the EIP-712 `TapSwap` (`tapSwapDigest`). The signature covers the router, direction and amount, so it can't be reused on another swap. The Box must be `Active` and unexpired in `GameBoxNames`, and each nonce works once per Box. A bad tap reverts the swap rather than falling back to 1% |
| Price | `PriceOracle` keeps 512 observations of the pool's tick, written before the first swap of each second, so a price moved inside one block counts for nothing. `observe` and `meanTick(window)` give the time-weighted price for the buyback and the dynamic floor |

The hook's address must carry its permission bits (`afterInitialize`, `beforeSwap`), so `DeployHook.s.sol` mines a
CREATE2 salt (`HookMiner.sol`) and deploys through the CREATE2 factory. It records the hook and the pool key
(`.pools.GBX_USDC`) but doesn't initialize the pool: the launch auction does, at its clearing price.

```sh
forge script script/DeployHook.s.sol --rpc-url sepolia --account sepolia-deployer --password '' --broadcast \
  --skip-simulation -g 150
```

`test/hook/` runs against Sepolia's real v4 `PoolManager` and test routers on the names fork, with real USDC.
`SwapVectors.t.sol` writes `packages/shared/src/swap/vectors.json`.
