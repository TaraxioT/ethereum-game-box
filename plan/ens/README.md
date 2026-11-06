# Game Box names on ENSv2: the build, in four prompts

This folder holds the prompts that build the Game Box's ENS names for real: contracts on Sepolia, verified on
Etherscan, a relayer that pays the gas, and a public site that reads and writes them live. Right now the site
showcases ENS on its own. The contracts are written so that, later, the Game Box contracts plug into them without a
redeploy.

| Prompt | Builds | Branch | Runs |
|---|---|---|---|
| [`1-contracts.md`](1-contracts.md) | The contracts, their forge tests, the deploy, Etherscan verification, and the shared TypeScript (`packages/shared/src/names/`) | `names-contracts` | first |
| [`2-relayer.md`](2-relayer.md) | `apps/relayer` (pays gas for signed requests) and `apps/demo-box` (a software Box with a software P-256 key) | `names-relayer` | after prompt 1's interface commit |
| [`3-site.md`](3-site.md) | `apps/web`: the names site, the story, the inspector | `names-site` | after prompt 1's interface commit, in parallel with 2 |
| [`4-review.md`](4-review.md) | An independent review of all three branches, before merging | (none) | last |

Paste a prompt's text (everything below its line) into a fresh Claude Code session in
`~/Workspace/ethereum-game-box`. Every session works in its **own git worktree** on its own branch, cut from `main`.
Another session has uncommitted work in the main checkout, so none of these sessions edits it.

## Before the first session starts

These are George's steps (the agent sessions can't do them):

1. **Done: `gamebox.eth` is owned by the deployer.** On Sepolia ENSv2, `gamebox.eth` is registered until
   2027-11-04 to the `sepolia-deployer` keystore (`0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E`), with every token role
   the `.eth` owner gets, including `SET_SUBREGISTRY`. It moved there in tx
   `0xa54f4eb435564386725643944f98a2b5d2075e8f16f025a6420af38d703ca9b7`.
2. **Fund the wallets on Sepolia.**
   - The deployer holds 0.13 ETH. That covers the deploy at a 1–2 gwei tip, since the whole deploy is about 45 M gas.
   - Fund the relayer (`sepolia-relayer`, `0x09a6f8C0194246c365bB42122E872626460F8a71`) to 0.2 ETH. Each name claim
     is about 2 M gas.
   - Operators and agents need no ETH: they sign with P-256, and the relayer pays.
3. **`.env` in the repo root.** Copy `.env.example` and fill in `ALCHEMY_API_KEY`. `ETHERSCAN_API_KEY` is already set
   in the shell, and prompt 1 adds it to `.env.example`.

## What the ENS track asks for, and where each piece answers it

The "Best Use of ENSv2" brief (ENS, $7k) asks for ENSv2 at the centre of the product, a functional demo with no
hard-coded values, a live demo link, and open source code.

| The brief says | We build |
|---|---|
| Deploy your own subname registry | `gamebox.eth`'s subregistry is our own `UserRegistry`, and each game has its own title registry |
| Resolve subnames off a parent's resolver (wildcard) | `gamebox.eth` has its own `PermissionedResolver` holding a default record. Any `*.gamebox.eth` name that isn't registered, or has expired, resolves through it: no address, and a `url` and `description` that say the name is free and where to claim it |
| Subnames get their own Permissioned Resolver and fully own their data | Every Box name and every player name gets its own `PermissionedResolver` |
| Record aliasing at the resolver level | A pop-up Box name is linked (`linkToNode`) to its Box's record, so `popup-x.gamebox.eth` serves exactly the same records as `mumbai-01.gamebox.eth`, while keeping its own expiry |
| Enhanced Access Control: an account can edit only certain text records | The game may write a player's `stats` and nothing else. A Box writes only `lastSeen` and `game`. The operator writes only its four keys |
| Expiring names | A Box's name expires with its licence. Pop-up Boxes have a 10-minute licence, so the expiry happens live on stage |
| Revocable names | Title registries are "managed": the parent keeps `UNREGISTER`, and that is how a title is taken from its holder. A Box's `status` goes to `suspended` or `revoked`, and the Box is then refused as a referee |
| Non-transferable vs transferable | The champion title `champion.<game>.gamebox.eth` is soulbound. Player names are transferable |
| Forever names with no parent control | Player names never expire. The registry is emancipated, and its canonical parent is locked |
| Bonus: agents as namespaces | `bot.gamebox.eth`, the practice opponent, has its own name, its own permissions and its ENSIP-26 records (`agent-context`, `agent-endpoint[mcp]`) |

Namespace aliasing (one registry under two labels) is the one brief item we leave out. The brief offers it as an
alternative to record aliasing, and nothing in the product needs it.

## The design, which all four prompts share

### Accounts and roles

| Account | Is | Holds |
|---|---|---|
No ECDSA key with any power lives on the Pi or on disk. Every account that holds a role is a **`P256Account`**,
and only a P-256 signature can move it. A different device holds each key, and the relayer pays every gas fee.

| Account | Is | Its key lives | Holds |
|---|---|---|---|
| Admin | a `P256Account` on George's passkey | George's phone or laptop (WebAuthn) | `DEFAULT_ADMIN_ROLE` and `LICENSOR_ROLE` on `GameBoxNames`, and `gamebox.eth`. Both move from the deployer once the deploy is done |
| Deployer and relayer (`sepolia-deployer`, `0xB2b6…C30E`) | one wallet, gas only | the cast keystore for deploy scripts, and a Worker secret for the relayer | nothing, once the admin hand-over is done |
| `LICENSOR_ROLE` | who issues Box licences | | Now: the admin account and `DemoLicences`. Later: the Box registry and the operator auction |
| `REFEREE_ROLE` | who reports a finished match | | Now: `BoxResults`. Later: the Game Box escrow's settle |
| Box | a `P256Account` | the HYP2003 token on the Pi (no extractable key). The demo Box's key is a Worker secret only | `lastSeen` and `game` on its Box name |
| Operator | a `P256Account` on the operator's passkey | the operator's phone or laptop. They act on the operator site, never on the Box | owns its Box name, writes `commission`, `location`, `description` and `games` |
| Agent | a `P256Account` | a Worker secret on the agent's Worker | `bot.gamebox.eth`, every role on its resolver, its ENSIP-26 records |
| Badge | any wallet that signs EIP-712: a HaLo badge at the event, a browser test key or a wallet on the site now | the badge | its player name and every role on its resolver |

The deployer is also the relayer (George funded it). Its key sits in a Cloudflare secret, so it must hold no power
once the deploy is done: the admin hand-over is what makes that safe. Deploy scripts and the relayer share one nonce,
so pause the relayer while a script broadcasts. The old `sepolia-relayer` wallet is retired.

### Contracts (`contracts/src/`)

- **`box/P256.sol`**: P-256 verification through the EIP-7951 precompile at `0x100` (live on Sepolia since Fusaka).
  It rejects a high `s` and treats an empty return (no precompile) as a failure, never as success.
- **`box/P256Account.sol`**: one account type for the Box, the operator, the agent and the admin. It is bound to one
  P-256 key and has `execute` (and `executeBatch`) with a nonce and a deadline, signed over EIP-712. Anyone may submit
  the call; the relayer does. It accepts two signature forms:
  - **raw** P-256 over the digest, for the HYP2003 token and Worker keys;
  - **WebAuthn**, a passkey assertion whose challenge is the digest, checked with the pinned OpenZeppelin's
    `WebAuthn.sol` over the same precompile.

  It also implements ERC-1271, so it can sign a `ClaimName` (the agent's claim), and the ERC-1155 receiver, so it can
  own names (the operator's Box name, the admin's `gamebox.eth`). Key rotation is `rotateKey`, signed by the current
  key.
- **`box/P256AccountFactory.sol`**: CREATE2 by public key, so an operator site can show a passkey's account address
  before the account exists. `accountOf(qx, qy)` and `deploy(qx, qy)`. Anyone may call `deploy`.
- **`names/IENSv2.sol`**: the slice of ENSv2 we call. Each signature is checked against the source the Sepolia
  deployment was built from.
- **`names/GameBoxNames.sol`**: the registrar. The roles it keeps on `gamebox.eth`'s registry are `REGISTRAR`,
  `RENEW` and their admins, and nothing else, so the registry is emancipated. (`isEmancipated()` counts only
  `CAN_TRANSFER_ADMIN`, `SET_SUBREGISTRY`, `SET_RESOLVER`, `UNREGISTER` and `UPGRADE`, with their admins.)
  - It holds `SET_PARENT` and its admin only long enough to call `setParent`, then revokes both from itself. That
    locks the canonical parent, so `findCanonicalName` can trust it.
  - `handOverRegistrar(next)` (admin): grants `REGISTRAR | RENEW` and their admins to a successor and revokes them
    from itself. This is how a later contract takes over issuing names without touching a single one. Emancipation
    holds throughout.
  - `registerBox(label, operator, box, qx, qy, expiry)` (LICENSOR), `renewBox`, `setBoxStatus`, `boxKey(label)`.
  - `setBoxKey(label, qx, qy, newBox)` (LICENSOR) rotates a lost Box:
    - the name's `addr` moves to the new `P256Account`;
    - `lastSeen` and `game` move to the new account and are revoked from the old one;
    - the old key stops working in `BoxResults` and in the relayer.

    For this, `GameBoxNames` holds `SET_ADDRESS`, `SET_TEXT_ADMIN` and `LINK` on each Box resolver, and nothing
    else. Nobody holds `UPGRADE` on a Box resolver.
  - `registerPopup(label, ofBox, expiry)` (LICENSOR): registers `popup-<label>.gamebox.eth` to `ofBox`'s operator
    with `ofBox`'s resolver, then `linkToNode`s it to `ofBox`'s record. It deploys no new resolver, so it is cheap.
  - `claimPlayer(label, badge, deadline, signature)`: open to anyone, and it needs the badge's EIP-712 consent. It
    accepts ECDSA, or ERC-1271 for a contract wallet. One name per badge, and `nameOf(badge)`.
  - `addGame(label, titleTerm)` (admin): `<game>.gamebox.eth` with its own title registry.
  - `crown(game, winner, round)` (REFEREE).
- **`names/PlayerStats.sol`**: the only `stats` writer the player resolvers know about. It keeps wins, losses and
  draws per game on chain and writes the `stats` text record. It takes writes only from REFEREE. If a player has
  revoked its role, it **skips that player** and emits an event. A revoked player must never be able to block their
  opponent's result.
- **`names/BoxResults.sol`** (the referee for now): `submit(result, r, s)` checks a match result signed by a Box's
  P-256 key, as registered in `GameBoxNames`. It refuses a Box whose name has expired or whose status isn't
  `active`, and a round it has already seen. Then it calls `crown` and `PlayerStats`. A draw writes stats only.
- **`names/DemoLicences.sol`** (a LICENSOR for now): `openPopup(label)` calls `registerPopup(label, "mumbai-01",
  now + 10 minutes)`, for anyone to call. That makes record aliasing and expiry something to watch, not something
  to explain.
- **`gamebox.eth`'s own resolver**: a `PermissionedResolver` proxy, set as `gamebox.eth`'s resolver on ETHRegistry.
  - It holds only the default record (the record linked to the empty name `0x00`): `url` (the site's claim page) and
    `description` ("This Game Box name is free."), with no `addr`.
  - The Universal Resolver keeps the deepest resolver it finds on the way down. A name that is unregistered or has
    expired has no resolver of its own, so the Universal Resolver falls back to this one and calls `resolve()` with
    the full name (wildcard, ENSIP-10). That name has no record of its own, so it gets the default.
  - Registered names have their own resolvers deeper in the tree, so the default never covers them.

Forward plan, which nothing in this build does yet: the Box registry and the operator auction take `LICENSOR_ROLE`,
and the escrow's settle takes `REFEREE_ROLE`. `DemoLicences` and `BoxResults` then lose their roles. No name, resolver
or `PlayerStats` record moves. Once `gamebox.eth` is renewed for years, its owner revokes `SET_SUBREGISTRY` on it,
which makes "forever" true. Doing that is irreversible, so it waits for George.

### Names and records

| Name | Expiry | Writers (Enhanced Access Control, one resolver per name) |
|---|---|---|
| `mumbai-01.gamebox.eth` | its licence (30 days) | `GameBoxNames`: `boxKey`, `status`. Operator: `commission`, `location`, `description`, `games`. Box: `lastSeen`, `game` |
| `popup-<x>.gamebox.eth` | 10 minutes | none of its own: linked to `mumbai-01`'s record on `mumbai-01`'s resolver, so it serves the same records. Once it expires, it resolves to `gamebox.eth`'s default (wildcard) |
| any unregistered `*.gamebox.eth` | n/a | `gamebox.eth`'s resolver's default record (wildcard): `url`, `description`, no `addr` |
| `<player>.gamebox.eth` | never (`2^64 − 1`) | badge: every role. `PlayerStats`: `stats` only, until the badge revokes it |
| `bot.gamebox.eth` | never | the agent: every role, and its ENSIP-26 records `agent-context` (Markdown: who it is, what it plays) and `agent-endpoint[mcp]`. `PlayerStats`: `stats` |
| `stockduel.gamebox.eth`, `quickdraw.gamebox.eth` | as `gamebox.eth` | `GameBoxNames` |
| `champion.stockduel.gamebox.eth` | 7 days after the last win | `GameBoxNames` only: `addr`, `holder`, `start`, `streak`, `round` |
| `champion.quickdraw.gamebox.eth` | 15 minutes after the last win | the same. The short term makes title expiry happen live |

Labels: 3 to 32 characters of `a-z`, `0-9` and `-`, with no hyphen at either end. They are checked on chain and in
`packages/shared`, so every name is already ENS-normalised.

### Signed messages

These are fixed in prompt 1's first commit. The contracts, the relayer, the demo Box and the site all use them from
`packages/shared/src/names/`, and a test checks each digest byte for byte against the contract.

- `ClaimName(string label, address badge, uint256 deadline)`: EIP-712, domain `Game Box Names`, version `1`,
  Sepolia, `GameBoxNames`.
- `Execute(address target, uint256 value, bytes32 dataHash, uint256 nonce, uint256 deadline)`: EIP-712, domain
  `Game Box`, version `1`, Sepolia, the `P256Account`. Signed with P-256, raw or WebAuthn. `executeBatch` signs
  `dataHash` over the ABI-encoded call list.
- `Result(string box, string game, uint256 round, address winner, address loser, bool draw, uint256 deadline)`:
  EIP-712, domain `Game Box Results`, version `1`, Sepolia, `BoxResults`. Signed with P-256.

### What every session knows about Sepolia

- Addresses come from `deployments/sepolia.json`, under `ens` (ENS's contracts, with the source of each) and
  `contracts` (ours, each with `address`, `deployBlock`, `txHash` and `verified`). Nothing hard-codes an address.
- Gas: about 1,542 gas per byte of new code and about 111k per new storage slot. A call that creates a resolver or
  a registry costs 1.3 to 4 M gas, and `eth_estimateGas` comes out too low for nested calls that create storage.
  Send those with an explicit limit of at least `2^24 + 4M`, or the estimate plus 50%. A limit above `2^24` holds the
  excess as a reservoir for state gas.
- The base fee is near zero today, so a tip of 1 to 2 gwei is enough.
- Load-balanced RPCs lag a block. Read at the receipt's block after a write.
- **Token ids.** A name's token id is its labelhash with a version in the low 32 bits. Any role grant or revoke on
  the name re-mints the token (`TokenRegenerated`), and unregistering or re-registering also orphans its old role
  grants. Key everything by labelhash, never by token id.
- **Renewal and revival.** `renew` never shortens an expiry (`CannotReduceExpiry`). On an expired name it needs root
  `RENEW`, and it brings back the old owner, token and roles. Registering again instead starts the name fresh.
- **Transfers.** A transfer needs the owner (not the caller) to hold `CAN_TRANSFER_ADMIN` on the name, otherwise it
  reverts `TransferDisallowed`. Admin roles on a name can be granted only at registration.
- **Resolver records.** Records live in numbered bundles, and a name links to one. The first write to a name creates
  its bundle. `linkToNode` and `linkToRecord` need root `LINK`.
- **Name lookups.** A name that has no resolver anywhere on its path makes the Universal Resolver revert
  `ResolverNotFound`. Treat that as "doesn't resolve", the same as a null result.
- **Libraries.** viem 2.35.0 or later. A sanity check: `ur.integration-tests.eth` must resolve to
  `0x2222…2222` on Sepolia, and `0x1111…1111` means the library is out of date.
- **Primary names.** Reverse resolution stays on the v1 reverse registrar on Sepolia (the `reverse` TLD is mirrored
  into ENSv2). Find its address the way `ensdomains/ens-cli` does (`ens set name --chain sepolia`). A badge that
  calls `setName("<player>.gamebox.eth")` gets that name back from `getEnsName`, because the Universal Resolver
  checks that the forward record matches.
- **The ENS app.** The docs say `sepolia.app.ens.domains` resolves through ENSv2. Check that it shows our names before
  linking to it.
