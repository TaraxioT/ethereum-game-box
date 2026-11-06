# contracts

Foundry. Every contract, its tests and its deploy scripts. All of it deploys to Sepolia.

## What goes here

| Folder | Holds |
|---|---|
| `src/box/` | The P-256 account every role-holder uses (`P256Account`), its factory (`P256AccountFactory`), and P-256 verification through the EIP-7951 precompile with low `s` enforced. Box licences and key rotation live in `names/GameBoxNames.sol` |
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
| `box/P256.sol` | P-256 verification through the EIP-7951 precompile at `0x100`. It refuses a high `s`, and an empty answer (a chain without the precompile) counts as invalid. The digest goes to the precompile as it is: a raw signer signs the 32-byte EIP-712 digest, with no SHA-256 |
| `box/P256Account.sol` | The account of the Box, an operator, the agent and the admin, bound to one P-256 key; no ECDSA key holds any power. `execute(target, value, data, nonce, deadline, signature)` and `executeBatch(calls, nonce, deadline, signature)` run what the key signed over EIP-712 `Execute` (domain `Game Box`); anyone may submit them. A signature is raw (`r ‖ s`, for the HYP2003 and Worker keys) or a passkey's WebAuthn assertion whose challenge is the digest, checked with OpenZeppelin's `WebAuthn.sol` with user verification required. Any unused nonce works once. It refuses an expired deadline, a used nonce and a high `s`, and a revert in a target bubbles up. ERC-1271 (raw) lets it sign a `ClaimName`; the ERC-1155 receiver lets it own names. `rotateKey` (a signed call to itself) moves it to a new key |
| `box/P256AccountFactory.sol` | Deploys `P256Account`s with CREATE2 salted by the key, so `accountOf(qx, qy)` gives a passkey's account before it exists. `deploy` is open to anyone |
| `names/GameBoxNames.sol` | The registrar of `gamebox.eth`. Its constructor creates `gamebox.eth`'s `UserRegistry`, the shared title resolver and the shared game resolver. It registers Box licences (`registerBox`, `renewBox`, `setBoxStatus`, `setBoxKey`), pop-up Boxes linked to their Box's record (`registerPopup`), player names (`claimPlayer`, with the badge's EIP-712 `ClaimName` consent, ECDSA or ERC-1271), games with their title registries (`addGame`) and champion titles (`crown`). It locks the canonical parent of every registry it creates, and `handOverRegistrar` moves its registry roles to a successor |
| `names/PlayerStats.sol` | Counts wins, losses and draws per player and game, and writes each player's `stats` record. It takes results only from `GameBoxNames`' `REFEREE_ROLE`. A player who revoked its `stats` role (or whose resolver fails) is skipped with `StatsSkipped`, and the opponent's result still settles |
| `names/BoxResults.sol` | The referee for now. `submit(result, r, s)` checks a result signed by a Box's P-256 key over EIP-712 `Result` (domain `Game Box Results`), then crowns the winner and records stats. It refuses an unknown Box, an expired Box, a Box that isn't `active`, a used `(box, round)`, an expired deadline, a player without a name, and `winner == loser` |
| `names/DemoLicences.sol` | A licensor for now. `openPopup(label)` calls `registerPopup(label, "mumbai-01", now + 10 minutes)`, for anyone |
| `names/DefaultRecord.sol` | `gamebox.eth`'s own `PermissionedResolver` set-up: the default record (on the empty name `0x00`) with `url` and `description` and no `addr`, which every free `*.gamebox.eth` name resolves to |
| `names/NameLib.sol` | The label rule (3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the DNS-encoded names and namehashes |

### Names and records

| Name | Expiry | Resolver | Writers |
|---|---|---|---|
| `gamebox.eth` | its `.eth` registration | its own, holding the default record | `gamebox.eth`'s owner: the default record's `url` and `description` |
| any free `*.gamebox.eth` | n/a | `gamebox.eth`'s (wildcard): the default record, no `addr` | nobody of its own |
| `<box>.gamebox.eth` | its licence | its own | `GameBoxNames`: `addr`, `boxKey`, `status`. Operator: `commission`, `location`, `description`, `games`. Box: `lastSeen`, `game` |
| `popup-<x>.gamebox.eth` | 10 minutes | its Box's, linked (`linkToNode`) to the Box's record | none of its own: it serves exactly its Box's records, then the default once it lapses |
| `<player>.gamebox.eth` | never (`2^64 − 1`) | its own | badge: every role. `PlayerStats`: `stats` only, until the badge revokes it |
| `bot.gamebox.eth` | never | its own | the agent's `P256Account`: every role, and its ENSIP-26 records. `PlayerStats`: `stats` |
| `<game>.gamebox.eth` | never: it lasts as long as `gamebox.eth` | the shared game resolver | `GameBoxNames`: `title`, `titleTerm` |
| `champion.<game>.gamebox.eth` | the term after the last win (7 days for Stock Duel, 15 minutes for Quick Draw) | the shared title resolver | `GameBoxNames`: `addr`, `holder`, `start`, `streak`, `round` |

Each Box and each player has its own resolver, because a `PermissionedResolver` role covers a key on every name the
resolver serves. Game names and titles have separate shared resolvers: when a name has no resolver, the Universal
Resolver falls back to the nearest parent's, so a lapsed title must not fall back to a resolver that still holds its
records. For the same reason a lapsed Box or pop-up name, or any label nobody registered, falls back to `gamebox.eth`'s
resolver: it has no record for that name, so it answers with its default record.

### Roles

| Where | Who | Holds |
|---|---|---|
| `GameBoxNames` (OpenZeppelin `AccessControl`) | deployer, until the admin hand-over | `DEFAULT_ADMIN_ROLE` (adds games, sets the stats writer, hands the registry roles over) and `LICENSOR_ROLE` |
| | `DemoLicences` | `LICENSOR_ROLE`: issues and manages Box licences and pop-ups |
| | `BoxResults` | `REFEREE_ROLE`: crowns, and is the role `PlayerStats` takes results from |
| `gamebox.eth`'s registry, root | `GameBoxNames` | `REGISTRAR \| RENEW` and their admins, and nobody else holds a root role, so it is emancipated. Nobody holds `SET_PARENT` |
| a title registry, root | `GameBoxNames` | `REGISTRAR \| UNREGISTER \| RENEW` and their admins. Moving a title is unregister + register, so it isn't emancipated. Nobody holds `SET_PARENT` |
| a Box or pop-up name's token | operator | nothing: it can't transfer the name or re-point its resolver or subregistry |
| a player name's token | badge | `UNREGISTER`, `RENEW`, `SET_SUBREGISTRY` and `SET_RESOLVER` with their admins, and `CAN_TRANSFER_ADMIN` |
| a title's token | holder | nothing: a transfer reverts `TransferDisallowed` |
| a Box resolver, root | `GameBoxNames` | `SET_TEXT_ADMIN \| SET_ADDRESS \| LINK`: it moves the Box's keys to a new account and links pop-ups to the Box's record. It only ever grants the eight Box keys. Nobody holds `UPGRADE` |
| a Box resolver, per key | `GameBoxNames`, operator, Box | `SET_TEXT` on its own keys (table above) |
| a player resolver, root | badge | every role and every admin role. `GameBoxNames` holds `SET_TEXT_ADMIN` only inside `claimPlayer`, to grant `stats`, and drops it in the same call |
| a player resolver, `stats` | `PlayerStats` | `SET_TEXT`, until the badge revokes it |
| the title and game resolvers, root | `GameBoxNames` | `SET_TEXT \| SET_ADDRESS`: it is their only writer |
| `gamebox.eth`'s resolver, root | `gamebox.eth`'s owner | `SET_TEXT \| SET_TEXT_ADMIN`: it rewrites the default record and can hand that on. Nobody holds `UPGRADE` |

Choices the design left open, made here:

- **A separate game resolver** (`GAME_RESOLVER`), with `title` and `titleTerm` on each game name, so a lapsed title has
  no records to fall back to.
- **Game names never expire** (`2^64 − 1`): a subname can't outlive `gamebox.eth`, so they last exactly as long as it.
- **The licensor's powers:** `renewBox`, `setBoxStatus`, `setBoxKey(label, qx, qy, account)` and `registerPopup` need
  `LICENSOR_ROLE`. `setBoxKey` takes the new account too, since the Box's key and its account move together.
- **A pop-up needs a live Box** (`BoxNotLive`), is registered to that Box's operator, and is not a Box of its own: it
  can't report results. `GameBoxNames` adds the `popup-` prefix.
- **A label that is or was a Box or a pop-up can't be claimed as a player name** (`LabelHeldByBox`), so pop-up labels
  can be reused.
- **`handOverRegistrar` also moves `UNREGISTER` and its admin on each title registry**, so the successor can move titles.
- **`executeBatch` signs `Execute` with the account itself as `target`**, `value` 0 and `dataHash` =
  `keccak256(abi.encode(calls))`. That encoding starts with four zero bytes, which match no function, so a batch
  signature never runs as a single call. `rotateKey` is a signed `execute` to the account itself.
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
forge takes `eth_estimateGas` from the node, and `-g 150` for the estimate plus 50%. `eth_estimateGas` comes out too
low for nested calls that create storage, so the scripts send every call that creates a registry, a resolver or an
account with an explicit limit of `2^24 + 4M` (`NamesScript.CREATE_GAS`); a limit above `2^24` holds the excess as a
reservoir for state gas. Measured on Sepolia:

| Action | Creates | Gas | Transaction |
|---|---|---|---|
| deploy `P256AccountFactory` | | 17,682,819 | `0x1f1e2a24…b38f8d` |
| deploy `GameBoxNames` | `gamebox.eth`'s registry, the title resolver, the game resolver | 37,734,927 | `0xbc9fb379…ff5772` |
| deploy `PlayerStats` | | 8,601,943 | `0xd01f88c2…59771a` |
| deploy `BoxResults` | | 7,594,877 | `0x76d2845b…55da5e` |
| deploy `DemoLicences` | | 1,952,190 | `0x0cec5700…3ce372` |
| `P256AccountFactory.deploy` | the demo Box's `P256Account` | 15,416,997 | `0x4afe6c08…7622cc` |
| `addGame` | a title registry | 2,336,519 (Stock Duel), 2,140,452 (Quick Draw) | `0xb7dc5da7…a877df`, `0x10a3706e…6d6952` |
| `VerifiableFactory.deployProxy` | `gamebox.eth`'s resolver with its default record | 1,475,830 | `0xe0df2a90…eb9e1e` |
| `setSubregistry`, `setResolver` on `gamebox.eth` | | 41,680, 41,668 | `0xaefc1183…b73d40`, `0xbad1032f…0b001b` |
| `grantRole` | | 133,505 | `0xddbccb29…ba0f2a` |

`registerBox`, `registerPopup` and `claimPlayer` are measured when `mumbai-01`, its first pop-up and `bot.gamebox.eth`
are registered.

### Deploy

From `contracts/`, with the repo `.env` loaded. No script reads a private key: the deployer signs through its cast
keystore, and the demo Box's key is given as its public key (`DEMO_BOX_QX`, `DEMO_BOX_QY`). Each script skips what is
already done, and a second run of a deploy script without `--broadcast` records each new contract's block and
transaction in `deployments/sepolia.json`. Scripts and the relayer share the deployer's nonce, so pause the relayer
while a script broadcasts.

```sh
F="--rpc-url sepolia --account sepolia-deployer --password '' --broadcast --skip-simulation --slow -g 150 \
  --with-gas-price 2gwei --priority-gas-price 1gwei"
forge script script/names/DeployNames.s.sol $F       # factory, contracts, roles, stats writer, the demo Box's account
forge script script/names/DeployNames.s.sol --rpc-url sepolia --account sepolia-deployer --password ''   # record
forge script script/names/AddGames.s.sol $F          # stockduel (7 days), quickdraw (15 minutes)
forge script script/names/PointGameBox.s.sol $F      # gamebox.eth -> our registry, and its default-record resolver
forge script script/names/RegisterBox.s.sol $F       # mumbai-01 for 30 days to OPERATOR_ACCOUNT (a P256Account)
```

`PointGameBox` needs the `.eth` owner of `gamebox.eth`. The operator's first records and the Box's heartbeat go through
their `P256Account`s and the relayer, never from a key on disk.

### Verify and check

- `pnpm names:verify` verifies our contracts with `forge verify-contract` (constructor arguments read from the creation
  transaction, or for an account the factory made, from its `AccountDeployed` event) and marks them `verified`. Every `VerifiableFactory` proxy is a 77-byte clone of one proxy logic contract
  (`ens.VerifiableProxyLogic`), which was unverified, and Etherscan's proxy verification alone left the proxies without
  source. So the script verifies that logic contract from the source ENS deployed it with: the metadata of ENS's
  `VerifiableFactory` deployment (`verifiable-factory` at `c1090aec`, solc 0.8.25, 1,000 runs) embeds every source
  file. Since then Etherscan shows the source of every clone, current and future. The script then links each proxy
  (`gamebox.eth`'s resolver and those found from `GameBoxNames`' events) to its ERC-1967 implementation with `verifyproxycontract`. Etherscan's API reports
  the clones as `Proxy = 2` (a minimal proxy of the logic contract), not `1`. Sourcify wasn't needed. Run it again
  after new claims and licences.
- `pnpm names:check` reads the live deployment and fails on any mismatch: every address has code, every contract and
  proxy is verified, each role table is as above (holders and assignee counts), and every name resolves through the
  Universal Resolver with stock viem: players, Boxes, live pop-ups as their Box, games, titles, and a free label as the
  default record.

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
