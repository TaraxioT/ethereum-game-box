# Prompt 1: the names contracts, their tests, the deploy and verification

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`.

---

You are building the Game Box's ENS names on ENSv2 on Sepolia: the contracts, their forge tests, the shared
TypeScript the other apps use, the deploy, and the source verification of every contract on Etherscan. Read
`CLAUDE.md`, `contracts/README.md`, `packages/shared/README.md` and `plan/ens/README.md` first. The README is the
design: its roles, names, records and signed messages are fixed. If something in it can't work on the real ENSv2
deployment, stop and say why before you change it.

Work in a new git worktree on branch `names-contracts`, cut from `main`. Don't touch the main checkout: another
session has uncommitted work there. Commit small, with the team trailers from `CLAUDE.md`, push after each green
step, and open a PR at the end. When you delegate, follow the effort rules: Opus at high for contract work, and
Sonnet at high for ports and simple packages.

## Ground truth: ENSv2 on Sepolia

- **Addresses.** Use https://docs.ens.domains/learn/deployments#sepolia-ensv2. Those are the contracts on branch
  `deploy/mainnet-v2-20261002` of https://github.com/ensdomains/contracts-v2 (`contracts/deployments/sepolia`). The
  `main` branch's `docs/addresses/sepolia.md` lists an older deployment, which the Universal Resolver no longer uses.
  Today these addresses hold code:
  - the Universal Resolver proxy `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` (viem's `ensUniversalResolver`);
  - ETHRegistry `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4`;
  - ETHRegistrar `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3`;
  - VerifiableFactory `0xda70306c98e97ece36f997a21368e53298572991`;
  - UserRegistry implementation `0x9bd8a88719068d09ecee662f36c0e3856708366a`;
  - PermissionedResolver implementation `0x115eb53f0c60696633855f90b138178fb40b2b2c`.

  Re-check every address against the docs and on chain, then record each one with its source in
  `deployments/sepolia.json` under `ens`.
- **Read the source** on that branch: `PermissionedRegistry`, `UserRegistry`, `RegistryRolesLib`,
  `PermissionedResolver`, `PermissionedResolverLib`, `EnhancedAccessControl`, `ETHRegistrar` and
  `VerifiableFactory`. Take every role bit, error name and resource computation from there. Also read the docs
  pages in `ensdomains/docs` (`src/pages/ensv2/*.mdx`), through `gh api`:
  - `permissioned-registry`
  - `permissioned-resolver`
  - `enhanced-access-control`
  - `registry-hierarchy`
  - `subnames`
  - `mutable-token-ids`
  - `tutorial-contract-developers`
- **This is the current resolver design.** The implementation at `0x115e…2b2C` is the "linked record" design:
  `linkToNode`, `linkToRecord` and `grantSetterRoles`, with no `setAlias`. Some older Sepolia deployment folders
  and the `main` branch show an earlier design. Build only against this one.
- **EAC facts:**
  - A role is a nybble, and its admin is `role << 128`.
  - At most 15 holders per role per resource.
  - A check passes on the specific resource or on root.
  - `grantRoles` and `revokeRoles` refuse the root resource; root uses `grantRootRoles` and `revokeRootRoles`.
  - Resolver resources: a text key is `uint256(keccak256(bytes(key)))`, a coin type is
    `uint256(keccak256(abi.encode(coinType)))`.
- **Traps:**
  - The Sepolia `PermissionedResolver` setters take the DNS-encoded name: `setText(bytes,string,string)`,
    `setAddress(bytes,uint256,bytes)`. Grant roles with `grantRootRoles` and `grantSetterRoles`, because
    `grantRoles` always reverts. `initialize(grants, calls)` runs `calls` with the role checks skipped, but a
    `grantSetterRoles` inside `calls` still reverts, since the factory is the caller there. Grant after deploying.
  - `PermissionedResolver` roles cover a key on every name the resolver serves, so each Box and each player gets its
    own resolver proxy.
  - A contract can own a name only if it accepts ERC-1155. So `GameBoxNames` implements the receiver (it holds the
    game names), while `BoxAccount` doesn't need to: the Box is a name's `addr` and a record writer, never its owner.
  - Register a name with token role bitmap `0` to make it non-transferable: `TransferDisallowed`. Moving a title is
    `unregister` + `register` on the game's title registry, which holds root `UNREGISTER` for that reason (so title
    registries are not emancipated). The token id changes on each move, so key titles by name.
  - `getResolver` returns zero once `block.timestamp >= expiry`, and the label becomes AVAILABLE. `renew` can only
    move the expiry later, and it also revives a lapsed name that nobody has registered again.
  - `safeTransferFrom` reverts `TransferUnsafeUntilRegistryIsEmancipated` on a registry that isn't emancipated.
  - forge's `makeAddr("alice")` addresses can have code on Sepolia. Prefix test labels and accounts so they can't
    collide with live state.

## Steps

### 1. Interfaces and shared types first (one commit, pushed before anything else)

Prompts 2 and 3 start from this commit, so make it complete and push it before you write any implementation:

- **The interfaces.** `contracts/src/names/IGameBoxNames.sol`, `IPlayerStats.sol`, `IBoxResults.sol`,
  `IDemoLicences.sol` and `contracts/src/box/IBoxAccount.sol`: every external function, event and error, with
  NatSpec.
- **`packages/shared/src/names/`:**
  - `keys.ts`: every record key, and the ENSIP-26 agent keys (read https://docs.ens.domains/ensip/26/ and use its
    keys exactly);
  - `labels.ts`: the label rule and `labelProblem(label)`;
  - `messages.ts`: the three EIP-712 types and their digest functions;
  - `abis.ts`: generated from `contracts/out` by a script, so it is never hand-written. Write it from the interfaces
    now, and regenerate it after the build;
  - `deployments.ts`: reads `deployments/sepolia.json`.
- **`deployments/sepolia.json`:** the `ens` block.

### 2. Contracts

Build what `plan/ens/README.md` describes, in `contracts/src/box/` and `contracts/src/names/`. Use OpenZeppelin
(installed with `forge install`, pinned to a release) for `AccessControl`, `EIP712`, `SignatureChecker` and
`ECDSA`. Set `evm_version = "osaka"` in `foundry.toml`, so the P-256 precompile exists in tests, and prove that it
does with a test.

Rules beyond the README:

- `GameBoxNames` never holds a role on a player's name or resolver once `claimPlayer` returns. It may hold
  `SET_TEXT_ADMIN` during the call, to grant `stats` to `PlayerStats`, and drops it in the same call.
- On each Box resolver, `GameBoxNames` keeps `SET_ADDRESS`, `SET_TEXT_ADMIN` and `LINK`, for rotation and pop-ups.
  It only ever grants the eight Box keys, and a test proves it. Nobody holds `UPGRADE` on a Box resolver or on the
  title resolver.
- `GameBoxNames` locks the canonical parent of every registry it creates. It grants itself `SET_PARENT` and its
  admin at `initialize`, calls `setParent`, then revokes both. `UserRegistry.initialize` reverts if no one holds a
  root role, so keep `REGISTRAR | RENEW` and their admins.
- `handOverRegistrar(next)` moves `REGISTRAR | RENEW` and their admins on every registry `GameBoxNames` runs.
- The UserRegistry trap: a later `grantRootRoles` needs the `_ADMIN` bit of each role, so the bitmap at
  `initialize` must include the admins of anything you will ever hand on.
- `BoxAccount` refuses an expired deadline, a used nonce, a high `s` and a call to itself.
- `BoxResults` refuses an unknown Box, a Box whose name has expired, a Box whose `status` isn't `active`, a used
  `(box, round)`, an expired deadline, a winner or loser without a player name, and `winner == loser`.
- Every function that creates a resolver or a registry has its Sepolia gas measured after the deploy, and the
  numbers go in `contracts/README.md`.
- No dead code, no admin back doors beyond the roles in the README, and NatSpec on every external function.

### 3. Tests (forge)

Run the tests on a fork of Sepolia pinned to a block number (`foundry.toml` `rpc_endpoints`, the URL from
`ALCHEMY_API_KEY`), against the live ENSv2 contracts, not mocks. Pure logic (labels, digests, P-256 wrappers) also
gets plain unit tests. Every rule and every refusal has a test. At least:

- **P-256**: a valid signature passes. A wrong key, a wrong digest and a high `s` fail. A missing precompile (call
  on a chain without it) fails and never passes.
- **BoxAccount**: execute works, a replayed nonce fails, an expired deadline fails, and a revert in the target
  bubbles up with its reason.
- **Box names**:
  - the role split, by eth_call from each party: nobody can write anyone else's keys, and the operator can't
    re-point the resolver or transfer the name;
  - `LabelAlreadyRegistered`;
  - `renew` revives a lapsed name and can't move the expiry earlier;
  - a lapse with `vm.warp`, after which the name stops resolving through the Universal Resolver and a second
    operator registers the label;
  - `suspended` and `revoked` are refused by `BoxResults`, but the name still resolves.
- **Player names**:
  - claims fail for the wrong signer, an expired deadline, a second name for the same badge, a taken label and a bad
    label;
  - an ERC-1271 wallet can claim;
  - `isEmancipated()` is true;
  - the badge holds every resolver role, and `PlayerStats` holds only `SET_TEXT` on `stats`;
  - the badge revokes `PlayerStats`, after which the opponent's result still settles and the revoked player's stats
    are skipped with an event.
- **Titles**:
  - crowning, then a move to a new winner (the old token is gone), then a repeat win (streak and expiry extended);
  - a transfer reverts `TransferDisallowed`;
  - after the term, the next winner takes the expired title;
  - the Quick Draw title expires after 15 minutes.
- **Pop-up Boxes (record aliasing)**:
  - `openPopup` registers for exactly 10 minutes, with `mumbai-01`'s resolver and no new resolver.
  - Through the Universal Resolver, the pop-up returns the same `addr` and every text record as `mumbai-01`, and an
    operator's change to `mumbai-01` shows on the pop-up at once.
  - After a `vm.warp` past the expiry, the pop-up falls back to the wildcard default. `mumbai-01` is unaffected.
  - It refuses a live label, and works again on the same label once it has lapsed.
- **Wildcard default**:
  - A label that was never registered returns `gamebox.eth`'s default record (`url` and `description`) and no
    address, through the Universal Resolver's `resolve`.
  - A registered player's own records always win over the default.
  - A name outside `gamebox.eth` is untouched.
- **Box key rotation**:
  - `setBoxKey` moves `addr`, `lastSeen` and `game` to the new `BoxAccount`.
  - The old account's writes then revert, and `BoxResults` refuses the old key.
- **Locks and hand-over**:
  - `SET_PARENT` has no holder on any registry we created.
  - `findCanonicalName` on our registry returns `gamebox.eth`.
  - After `handOverRegistrar(next)`, `GameBoxNames` can't register, `next` can, and `isEmancipated()` is still true.
- **Fuzz** labels against `labelProblem`'s rule, and the claim signature's fields.
- **Invariant:** across random sequences of claims, results and revocations, `GameBoxNames` never holds a role on any
  player resolver.
- **Digest vectors**: a forge test writes the three digests for fixed inputs to
  `packages/shared/src/names/vectors.json`, and a Vitest test in `packages/shared` checks that `messages.ts` produces
  the same bytes.
- **The whole flow end to end on the fork**: set up `gamebox.eth`, claim two players, play a signed result, crown,
  move the title and expire a pop-up. Every read in it goes through viem-equivalent Universal Resolver calls
  (`resolve` with `addr` and `text`), the same path the site uses.

`pnpm contracts:test`, `pnpm typecheck` and `pnpm test` pass at the root.

### 4. Deploy (Sepolia)

Write the deploy as forge scripts in `contracts/script/`, broadcast with the `sepolia-deployer` keystore
(`--account sepolia-deployer --password ''`). Each script writes its addresses, deploy block and tx hash to
`deployments/sepolia.json`. Keep the order idempotent: a script that finds its contract already deployed skips it.

1. `P256` (if it is a library that must be deployed), `GameBoxNames` (its constructor creates `gamebox.eth`'s
   `UserRegistry` and the shared title resolver through the factory), `PlayerStats`, `BoxResults` and
   `DemoLicences`. Grant `REFEREE_ROLE` to `BoxResults` and `LICENSOR_ROLE` to `DemoLicences`, and set the stats
   writer.
2. Point `gamebox.eth`'s subregistry at the new registry. Stop with a clear message if the deployer doesn't own
   `gamebox.eth`. (It does: it was moved there on 2026-11-06.)
   - Deploy `gamebox.eth`'s own `PermissionedResolver` through the factory, with the deployer as its only root
     holder.
   - Write its default record (`url` and `description` on the empty name `0x00`).
   - Set it as `gamebox.eth`'s resolver on ETHRegistry (the deployer holds `SET_RESOLVER` on the name).
3. `addGame("stockduel", 7 days)` and `addGame("quickdraw", 15 minutes)`.
4. Generate the demo Box's P-256 key and the operator and agent EOAs. Keep their private keys only in `.env`
   (`DEMO_BOX_P256_KEY`, `DEMO_OPERATOR_KEY`, `AGENT_PRIVATE_KEY`) and add the names, without values, to
   `.env.example`. Never print a private key. Deploy the demo Box's `BoxAccount`.
5. `registerBox("mumbai-01", operator, demoBoxAccount, qx, qy, now + 30 days)`. The operator writes its four keys,
   and the demo Box writes `lastSeen` and `game` through `BoxAccount.execute`. Send that call from the deployer for
   now; the relayer takes it over in prompt 2.
6. The agent claims `bot.gamebox.eth` with its own signature and writes its ENSIP-26 records itself.

Gas: send with the explicit limits from `plan/ens/README.md`, at a 1–2 gwei tip. Report the ETH spent.

### 5. Verify every deployed contract

**Source verification on Etherscan:**

- Every contract we deploy is verified with `forge script --verify` or `forge verify-contract`
  (`ETHERSCAN_API_KEY`, the Etherscan v2 API, chain 11155111), with its constructor arguments.
- The proxies that ENS's `VerifiableFactory` creates for us (`gamebox.eth`'s registry, each title registry and every
  resolver) are 77-byte proxies. Today Etherscan shows them unverified, because the proxy logic they clone
  (`0xC41576B4B809B99CF0fF2e5B41b4F147cd9b6BDd`) is unverified too. The implementations they point at (the ERC-1967
  slot) are already verified.
- Try, in this order:
  1. Etherscan's proxy verification (`verifyproxycontract`) on one proxy;
  2. if that is refused, verify the proxy logic contract from the source in `ensdomains/verifiable-factory` at the
     commit the deployment used, then retry the proxy;
  3. if Etherscan still refuses, verify on Sourcify.
- Script it (`pnpm names:verify`) so that every new resolver, from every later claim, can be verified the same way.
  Record what worked in `contracts/README.md`.

**On-chain checks:** `pnpm names:check` reads the live deployment and fails on any mismatch:

- every address in `deployments/sepolia.json` has code;
- every proxy we created passes `VerifiableFactory.verifyContract(proxy)` and returns the implementation we expect.
  That proves on chain that it runs ENS's stock code;
- `ur.integration-tests.eth` resolves to `0x2222…2222` with the client the checks use;
- an unregistered `*.gamebox.eth` label returns the wildcard default;
- every contract is verified (`getsourcecode` returns a contract name, and proxies show `Proxy = 1` with their
  implementation);
- the roles are exactly as designed. That means `isEmancipated()` on `gamebox.eth`'s registry, `GameBoxNames`'s root
  roles there, and the role table of each Box and player resolver, read with `roles`/`hasRoles`;
- every name resolves through the Universal Resolver with stock viem (`getEnsAddress`, `getEnsText`) on a plain
  Sepolia client.

Also report whether `sepolia.app.ens.domains/<name>` shows the names: judges will check their name on their phone.

**Primary names.** Reverse resolution on Sepolia uses the v1 reverse registrar, mirrored into ENSv2. Find its address
the way `ensdomains/ens-cli` does. Then have one test player call `setName("<label>.gamebox.eth")` from its own wallet,
and check that `getEnsName(address)` returns it. This is the badge's own transaction, not part of `claimPlayer`.
Record the address and the result in `contracts/README.md` and `packages/shared/src/names/`, so the site can offer it.

### 6. Docs

- `contracts/README.md`: what each names contract does, the role table, the forward plan (from `plan/ens/README.md`),
  the measured Sepolia gas, and how to deploy, verify and check.
- `packages/shared/README.md`: the `names/` modules.
- `deployments/README.md`: the `ens` and `contracts` blocks.

## Done when

- Every test passes. The deploy is live, `pnpm names:verify` and `pnpm names:check` pass against it, and the PR shows:
  - the Etherscan links;
  - the gas measured on Sepolia;
  - the ETH spent;
  - any check that is still unresolved, named as such.
