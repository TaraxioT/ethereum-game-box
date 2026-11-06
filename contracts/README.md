# contracts

Foundry. Every contract, its tests and its deploy scripts. All of it deploys to Sepolia.

## What goes here

| Folder | Holds |
|---|---|
| `src/box/` | The P-256 account every role-holder uses (`P256Account`), its factory (`P256AccountFactory`), and P-256 verification through the EIP-7951 precompile with low `s` enforced. Box licences and key rotation live in `names/GameBoxNames.sol` |
| `src/game/` | Match escrow: `DuelPot`, one USDC pot per match (open, settle, refund) |
| `src/token/` | The Game Box token and its launch through Uniswap's auction, and the demo's test USDC (`FakeUSDC`) |
| `src/hook/` | The Uniswap v4 hook: three fee levels and the time-weighted price |
| `src/staking/` | Staking to a Box, rewards, commission, and the operator auction |
| `src/names/` | ENS names under `gamebox.eth`: Boxes, players, titles, championships |
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
but don't deploy (the v4 `PoolManager` and its test routers) sit under `external`.

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
| `names/PlayerStats.sol` | Counts each player's wins, losses and draws over every game and game by game, with the win streak across games (a loss or a draw ends it) and the best streak, and writes them to the player's `stats` record. Keeps the top 10 (most wins, then who reached them first) and writes them to `gamebox.eth`'s `leaderboard` record. It takes results only from `GameBoxNames`' `REFEREE_ROLE`. A player who revoked its `stats` role (or whose resolver fails) is skipped with `StatsSkipped`, a refused leaderboard write with `LeaderboardSkipped`, and the result still settles |
| `names/BoxResults.sol` | The referee for now. `submit(result, r, s)` checks a result signed by a Box's P-256 key over EIP-712 `Result` (domain `Game Box Results`), then crowns the winner, records stats, settles the match's open `DuelPot` pot (which must succeed) and scores the game's open championship (in a `try` capped at `SCORE_GAS`, 3M: a failure emits `ScoreSkipped` and the result stands). One Box signature settles everything. It refuses an unknown Box, an expired Box, a Box that isn't `active`, a used `(box, round)`, an expired deadline, a player without a name, `winner == loser`, and too little gas left to give `score` its full cap (`InsufficientGas`) |
| `names/BoxSeats.sol` | Box-vouched player names. A HaLo badge can't sign a `ClaimName`, so the Box it tapped signs EIP-712 `Seat(label, badge, box, deadline)` (domain `Game Box Seats`) with its P-256 key, and `claim(seat, r, s)` calls `GameBoxNames.claimPlayerFor` (it holds `SEATER_ROLE`). The name, resolver and roles are exactly `claimPlayer`'s. It refuses an unknown, expired or not-`active` Box, a bad signature and an expired deadline; a second name for the badge reverts `BadgeHasName` |
| `names/Championships.sol` | Time-boxed championships, each a name in its game's registry: `<label>.<game>.gamebox.eth`, one open per game. `open` (admin) registers it to the contract until `ends + 1 day` with its own resolver, writes `ends`, `prize` and `standings`, and takes the USDC prize. `score` (a referee: `BoxResults`) adds win 3, draw 1, loss 0 and rewrites `standings` (top 5, JSON), `leader` and `addr`. `close` (anyone, after `ends`) pays the winner (most points, then most wins, then who reached that score first), registers the name to the winner with no expiry and token roles 0, writes `standings`, `winner` and `addr`, and revokes every role it holds on the resolver: nobody holds one after that, so the records are frozen. With no players the prize goes back and the name is unregistered |
| `names/BoxCheck.sol`, `names/IBoxSigned.sol` | What every Box-signed message shares (`BoxResults`, `DuelPot`, `BoxSeats`): a registered, unexpired, `Active` Box's key, a low-`s` P-256 signature, a deadline, and their errors |
| `game/DuelPot.sol` | One USDC pot per match. `open(stake, r, s)` checks EIP-712 `Stake(box, game, round, a, b, amount, deadline)` (domain `Game Box Stakes`) signed by a live, `Active` Box's P-256 key and pulls `amount` from each player as USDC's game spender. `settle` (a referee: `BoxResults`) pays the winner both stakes or refunds both on a draw; the result's game and players must be the pot's. `refund` is open to anyone an hour after `open` if the pot is unsettled. The round number is the shared key: a match's `Stake` and `Result` carry the same `(box, round)`. It refuses `a == b`, a zero amount and a `(box, round)` that had a pot |
| `token/FakeUSDC.sol` | The demo's stake token: 6 decimals, "USD Coin (Game Box test)", `USDC`. `MINTER_ROLE` (the deployer, which is the relayer) mints. One game spender, set once to `DuelPot`, moves balances with no allowance, because a badge can't sign an approval or a permit. Every USDC in the project is this token: stakes, prizes, staking fees and the GBX/USDC pool |
| `names/DemoLicences.sol` | A licensor for now. `openPopup(label)` calls `registerPopup(label, "mumbai-01", now + 10 minutes)`, for anyone |
| `names/DefaultRecord.sol` | `gamebox.eth`'s own `PermissionedResolver` set-up: the default record (on the empty name `0x00`) with `url` and `description` and no `addr`, which every free `*.gamebox.eth` name resolves to |
| `names/NameLib.sol` | The label rule (3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the DNS-encoded names and namehashes |

### Names and records

| Name | Expiry | Resolver | Writers |
|---|---|---|---|
| `gamebox.eth` | its `.eth` registration | its own, holding the default record | `gamebox.eth`'s owner: the default record's `url` and `description`. `PlayerStats`: `leaderboard` only, on `gamebox.eth` itself |
| any free `*.gamebox.eth` | n/a | `gamebox.eth`'s (wildcard): the default record, no `addr` | nobody of its own |
| `<box>.gamebox.eth` | its licence | its own | `GameBoxNames`: `addr`, `boxKey`, `status`. Operator: `commission`, `location`, `description`, `games`. Box: `lastSeen`, `game` |
| `popup-<x>.gamebox.eth` | 10 minutes | its Box's, linked (`linkToNode`) to the Box's record | none of its own: it serves exactly its Box's records, then the default once it lapses |
| `<player>.gamebox.eth` | never (`2^64 − 1`) | its own | badge: every role. `PlayerStats`: `stats` only, until the badge revokes it |
| `bot.gamebox.eth` | never | its own | the agent's `P256Account`: every role, and its ENSIP-26 records. `PlayerStats`: `stats` |
| `<game>.gamebox.eth` | never: it lasts as long as `gamebox.eth` | the shared game resolver | `GameBoxNames`: `title`, `titleTerm` |
| `champion.<game>.gamebox.eth` | the term after the last win (7 days for Stock Duel, 15 minutes for Quick Draw) | the shared title resolver | `GameBoxNames`: `addr`, `holder`, `start`, `streak`, `round` |
| `<label>.<game>.gamebox.eth` (a championship, such as `mumbai-cup.stockduel.gamebox.eth`) | `ends + 1 day` while open; never once closed (`2^64 − 1`, the winner's) | its own | `Championships` while open: `ends`, `prize` (USDC base units), `standings`, `leader`, `addr` (the leader). At close it writes `standings`, `winner` and `addr` (the winner), then revokes its roles: nobody, the contract and the deployer included, can write it again |

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
| | `BoxResults` | `REFEREE_ROLE`: crowns, and is the role `PlayerStats`, `DuelPot.settle` and `Championships.score` take results from |
| | `BoxSeats` | `SEATER_ROLE`: `claimPlayerFor`, a player name for a badge a Box vouched for |
| `GameBoxNames.championships` | `Championships` | set once (`setChampionships`); `addGame` grants it its title-registry roles |
| `FakeUSDC` (OpenZeppelin `AccessControl`) | deployer | `DEFAULT_ADMIN_ROLE` (sets the game spender once) and `MINTER_ROLE` |
| | `DuelPot` | the game spender: `transferFrom` with no allowance |
| `Championships` (OpenZeppelin `AccessControl`) | deployer | `DEFAULT_ADMIN_ROLE`: opens championships |
| `gamebox.eth`'s registry, root | `GameBoxNames` | `REGISTRAR \| RENEW` and their admins, and nobody else holds a root role, so it is emancipated. Nobody holds `SET_PARENT` |
| a title registry, root | `GameBoxNames` | `REGISTRAR \| UNREGISTER \| RENEW` and their admins. Moving a title is unregister + register, so it isn't emancipated. Nobody holds `SET_PARENT` |
| | `Championships` | `REGISTRAR \| UNREGISTER \| RENEW`, no admin bit, so it can grant nothing on. It needs them to open the next championship; no function of it touches a closed one |
| a championship's token | `Championships` while open, then the winner | nothing: it can't be transferred or re-pointed |
| a championship's resolver, root | `Championships` while open | `SET_TEXT \| SET_ADDRESS` and their admins. At close it revokes all four, so nobody holds any role and the records are frozen. Nobody ever holds `UPGRADE` |
| a Box or pop-up name's token | operator | nothing: it can't transfer the name or re-point its resolver or subregistry |
| a player name's token | badge | `UNREGISTER`, `RENEW`, `SET_SUBREGISTRY` and `SET_RESOLVER` with their admins, and `CAN_TRANSFER_ADMIN` |
| a title's token | holder | nothing: a transfer reverts `TransferDisallowed` |
| a Box resolver, root | `GameBoxNames` | `SET_TEXT_ADMIN \| SET_ADDRESS \| LINK`: it moves the Box's keys to a new account and links pop-ups to the Box's record. It only ever grants the eight Box keys. Nobody holds `UPGRADE` |
| a Box resolver, per key | `GameBoxNames`, operator, Box | `SET_TEXT` on its own keys (table above) |
| a player resolver, root | badge | every role and every admin role. `GameBoxNames` holds `SET_TEXT_ADMIN` only inside `claimPlayer`, to grant `stats`, and drops it in the same call |
| a player resolver, `stats` | `PlayerStats` | `SET_TEXT`, until the badge revokes it |
| the title and game resolvers, root | `GameBoxNames` | `SET_TEXT \| SET_ADDRESS`: it is their only writer |
| `gamebox.eth`'s resolver, root | `gamebox.eth`'s owner | `SET_TEXT \| SET_TEXT_ADMIN`: it rewrites the default record and can hand that on. Nobody holds `UPGRADE` |
| `gamebox.eth`'s resolver, `leaderboard` | `PlayerStats` | `SET_TEXT`, granted by `PointGameBox` |

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
- **`DuelPot.settle` and `Championships.score` check `REFEREE_ROLE` on `GameBoxNames` too**, like `PlayerStats`, so
  `BoxResults` is granted in one place and nothing has to know its address at deploy. `settle` takes the result's
  game and loser as well as the winner, and refuses a result for other players or another game (`PotMismatch`).
- **A refunded pot doesn't block its result**: `BoxResults` settles only an open pot, so a result that arrives after
  the hour's refund still crowns and scores.
- **Championship records**: `prize` is in USDC base units, `leader` and `winner` are player names, and `standings` is
  a JSON array in rank order of `{"name","addr","points","wins","draws","losses"}` (`parseStandings` in
  `@egb/shared/names`). `close` on a name nobody closed within the day's grace (lapsed) registers it to the winner all
  the same.
- **A Box is its own operator for now**: `mumbai-01` and `demo-01` are registered to their own `P256Account`s, since
  the operator passkey is parked. `RegisterBox` takes `OPERATOR_ACCOUNT` once there is one.
- **`PlayerStats` checks `REFEREE_ROLE` on `GameBoxNames`**, so referees are granted in one place. It keeps counting a
  revoked player on chain, and writes `stats` in a caught call capped at 400k gas: a badge controls its resolver and
  could upgrade it to one that burns all its gas. The `leaderboard` write is caught the same way, capped at 1M. It
  refuses to start without gas for every cap (`InsufficientGas`), so a sender can't force a skip.
- **The leaderboard ranks by wins, then who reached them first**, so only a winner moves and only up: the top 10 stay
  exact without a sort over every player. Each result rewrites the whole list, so every row's streak is current.

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

v3 (2026-11-06), the same flags:

| Action | Creates | Gas | Transaction |
|---|---|---|---|
| deploy `GameBoxNames` | `gamebox.eth`'s registry, the title resolver, the game resolver | 38,907,207 | `0xfc47ce3c…` |
| deploy `PlayerStats` | | 8,601,955 | `0xb63495ad…` |
| deploy `FakeUSDC` | | 5,498,546 | `0x39e792da…` |
| deploy `DuelPot` | | 10,170,127 | `0x9c6e2e0d…` |
| deploy `Championships` | | 23,312,613 | `0x12069035…` |
| deploy `BoxResults` | | 9,469,822 | `0xc86763b0…` |
| deploy `DemoLicences` | | 1,952,202 | `0xd685fbff…` |
| deploy `BoxSeats` | | 5,081,690 | `0xe28732cf…` |
| `addGame` | a title registry, with `Championships`' roles | 2,455,094 (Stock Duel), 2,259,027 (Quick Draw) | `0x0d79d330…`, `0x2400bab2…` |
| `P256AccountFactory.deploy` | `mumbai-01`'s `P256Account` | 15,416,997 | `0x66c937e2…` |
| `registerBox` | a Box resolver | 4,651,555 (`mumbai-01`), 4,761,702 (`demo-01`) | `0xe5b74913…`, `0x1960d224…` |
| `Championships.open` | a championship's resolver | 2,667,938 | `0x2bc879d4…` |
| `Championships.score` (`eth_estimateGas` from `BoxResults`, the first result) | | 1,735,304 | |

`score` costs most of its gas in new storage (the `standings` text grows with each new row), so `BoxResults` caps it
at 3M (`SCORE_GAS`), and a result needs that much left when it reaches it. The whole v3 deploy spent 0.137 ETH at a
1 gwei tip.

### Deploy

From `contracts/`, with the repo `.env` loaded. No script reads a private key: the deployer signs through its cast
keystore, and the demo Box's key is given as its public key (`DEMO_BOX_QX`, `DEMO_BOX_QY`). Each script skips what is
already done, and a second run of a deploy script without `--broadcast` records each new contract's block and
transaction in `deployments/sepolia.json`. Scripts and the relayer share the deployer's nonce, so pause the relayer
while a script broadcasts.

```sh
F="--rpc-url sepolia --account sepolia-deployer --password '' --broadcast --skip-simulation --slow -g 150 \
  --with-gas-price 2gwei --priority-gas-price 1gwei"
forge script script/names/DeployNames.s.sol $F       # factory, names, stats, USDC, pots, championships, results,
                                                     # licences, seats; roles, stats writer, championships, spender
forge script script/names/DeployNames.s.sol --rpc-url sepolia --account sepolia-deployer --password ''   # record
forge script script/names/AddGames.s.sol $F          # stockduel (7 days), quickdraw (15 minutes)
forge script script/names/PointGameBox.s.sol $F      # gamebox.eth -> our registry, and its default-record resolver
BOX_LABEL=mumbai-01 BOX_QX=0x… BOX_QY=0x… BOX_ACCOUNT=MumbaiBoxAccount \
  forge script script/names/RegisterBox.s.sol $F     # 30 days, the Box's account made if missing
CUP_LABEL=mumbai-cup forge script script/names/OpenChampionship.s.sol $F   # CUP_GAME, CUP_MINUTES, CUP_PRIZE
```

The Pi's HYP2003 public key is `python3 /home/pi/gamebox/current/deploy/p256-signer/hyp2003_signer.py --pubkey` on the
Pi; the demo-box Worker's is `qx`/`qy` in its `GET /box`. `RegisterBox` makes the Box its own operator unless
`OPERATOR_ACCOUNT` is set. `OpenChampionship` closes the game's ended championship first, mints the deployer what the
prize needs and approves it; pick a fresh label each time, since a closed championship's name is its winner's for
good. A new `GameBoxNames` means deleting its entry in `deployments/sepolia.json` before `DeployNames`: every contract
bound to the old one is then deployed again, and the factory and USDC stay. Deleting `PlayerStats`' entry brings a new
`PlayerStats` and `BoxResults` (the old `BoxResults` loses `REFEREE_ROLE`); run `PointGameBox` after it, so the new
`PlayerStats` may write the leaderboard. Names claimed before keep the old writer on their `stats`. `PointGameBox` needs the `.eth` owner of `gamebox.eth`. The operator's first records and the Box's heartbeat go through
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
  proxy is verified, each role table is as above (holders and assignee counts, championship resolvers included: only
  `Championships` while open, nobody once closed), and every name resolves through the Universal Resolver with stock
  viem: players, Boxes, live pop-ups as their Box, games, titles, championships (standings and leader or winner), and
  a free label as the default record.

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

`test/staking/BoxStaking.t.sol` runs on the same Sepolia fork as the names tests, against the fork's `FakeUSDC` and a
fresh `GameBoxNames`. Any archive RPC works as `SEPOLIA_RPC_URL`; the public `https://sepolia.gateway.tenderly.co` does.

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

`test/hook/` runs against Sepolia's real v4 `PoolManager` and test routers on the names fork, with the fork's
`FakeUSDC`.
`SwapVectors.t.sol` writes `packages/shared/src/swap/vectors.json`.
