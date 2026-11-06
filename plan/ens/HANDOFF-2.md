> **Parked.** The operator site, passkeys, the agent and the admin hand-over wait until after `HANDOFF-3.md`, which
> is the current work.

# Handoff 2: finish the Game Box names on ENSv2

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`. Stop the session
that ran the first handoff before you start this one, so two sessions never write the same worktrees.

---

You are taking over the build of the Game Box's ENS names on ENSv2 on Sepolia. It is about half done. The first
version of the contracts is live and verified, both Workers are deployed, and the site is being built. Since then
George made two changes:
- the names contracts gain pieces the brief asks for, so they are redeployed as v2;
- every account that holds power now signs with P-256: the Box, the operator and the admin on passkeys, and the
  agent from a Worker secret.

Your job is to land both, finish the apps and open the PRs. A review and the final checks come after that, when
George asks.

## Read first

- `CLAUDE.md`
- `plan/ens/README.md`: **the design, and the source of truth.** Read all of it, especially "Accounts and roles",
  "Contracts", "Names and records", "Signed messages" and the Sepolia facts.
- `plan/ens/1-contracts.md`, `2-relayer.md` and `3-site.md`: the detail for each part. Where they disagree with the
  README, the README wins.

## Where things stand

- **Branches and worktrees.** There are three, each on its own branch and pushed to origin:
  - `names-contracts` (`.claude/worktrees/agent-a2710e9fdba4e1278`);
  - `names-relayer` (`…/agent-a7b97a4a375c4cb2e`): uncommitted edits in both `wrangler.jsonc` files and the live smoke
    test;
  - `names-site` (`…/agent-ad5a83c6564bd04db`): an uncommitted `.claude/` folder.

  Look at the uncommitted edits before anything else. Commit them if they are finished work; otherwise say what they
  are. `main` has a teammate's GBX and Foundry setup, which `names-contracts` builds on (Solidity 0.8.26, their pinned
  OpenZeppelin and forge-std, `evm_version = "osaka"`). Two of their files change, both with George's approval:
  `Deployments.sol`, which now records objects, and the `SEPOLIA_RPC_URL` endpoint.
- **Live v1, to be replaced.** These are in `deployments/sepolia.json` on `names-contracts`, all verified:
  - `GameBoxNames` `0xb090…62c5`
  - `PlayerStats` `0xed85…7e14`
  - `BoxResults` `0x925F…ccdA`
  - `DemoBoxAccount` `0x3dfb…d082`
  - `DemoLicences` `0x2260…2830`

  It has 81 forge tests on a Sepolia fork, `names:check`, `names:verify`, and primary names through ENS's reverse
  registrar. **`gamebox.eth` is not re-pointed yet**, so nothing under the new registry resolves.
- **Workers:** the [relayer](https://gamebox-relayer.mathew.workers.dev) and the
  [demo Box](https://gamebox-demo-box.mathew.workers.dev), with 79 unit tests. The demo Box's crash (Cloudflare 1101) is
  fixed.
- **The site** is in comp B, "Schematic", which George picked.
- **Settled between the agents:** the Box signs the raw EIP-712 digest with low-`s` P-256 through `@noble/curves`.
  The API types and the fixed test signatures live in `packages/shared`.
- **Wallets:**
  - The deployer `sepolia-deployer` (`0xB2b6B516Df4B159c0E4Eb1d6D7D65a5f2F04C30E`) holds about 5 ETH and owns
    `gamebox.eth` until 2027-11-04.
  - The old relayer wallet (`0x09a6…8A71`, 0.378 ETH) is retired. Leave its ETH alone; George decides what happens to
    it.
  - The EOAs `0xEf4a…20F9` (operator) and `0xD736…7E3F` (agent) are dropped. Don't fund them.
- **`.env`** (gitignored) holds `SEPOLIA_RPC_URL` (George's Chainstack node), `DEMO_BOX_P256_KEY`,
  `DEMO_OPERATOR_KEY` and `AGENT_PRIVATE_KEY`. By the end, it holds no private keys.

## George's decisions

1. **Re-point `gamebox.eth`: yes, to the v2 registry.** `priya` and the old `mumbai-01` belong to old test wallets.
   They stop resolving, and that's fine.
2. **No key with any power on the Pi or on disk.**
   - Every account that holds a role is a `P256Account`. Operators manage their Box with a passkey on a separate
     operator site, never on the Box.
   - The agent's key is a Worker secret. The relayer pays all gas.
   - Admin rights and `gamebox.eth` end on George's admin passkey account.
3. **The deployer is also the relayer.** Its key goes into the relayer's Worker secret, so after the hand-over it must
   hold no power at all.

## The work

How to run it:
- Give each part its own subagent, with `isolation: "worktree"`, on the branch named below.
- Use Opus at high for every part. Never use xhigh, and never Sonnet below high.
- Each part owns its folders, the same as before:
  - contracts: `contracts/`, `packages/shared/`, `deployments/`;
  - relayer: `apps/relayer/`, `apps/demo-box/`;
  - site: `apps/web/`;
  - operator site: `apps/operator/`.

  A request into another part's files goes through you.
- Start A first. B, C and D can start from A's first interface commit.

### A. Contracts v2 (`names-contracts`)

Add what the README describes and the branch lacks, each with the tests `1-contracts.md` lists:

- **`P256Account`** (replacing `BoxAccount`):
  - `execute` and `executeBatch`, over the EIP-712 `Execute`;
  - raw P-256 signatures, and WebAuthn through the pinned OpenZeppelin `utils/cryptography/WebAuthn.sol`, with user
    verification required;
  - ERC-1271 (raw P-256), the ERC-1155 receiver, and `rotateKey`.

  Its tests cover:
  - a wrong challenge, a wrong `type`, no user verification, a high `s`, a replay and an expired deadline all fail;
  - `rotateKey` cuts the old key off.

  Put fixed WebAuthn vectors in `packages/shared`.
- **`P256AccountFactory`**: CREATE2 keyed by `(qx, qy)`, with `accountOf` and `deploy`. Anyone may deploy.
- **`claimPlayer` accepts ERC-1271**, so an agent account can claim.
- **`registerPopup(label, ofBox, expiry)`**: it uses the Box's resolver and `linkToNode`s the pop-up to the Box's
  record (record aliasing). `GameBoxNames` gets root `LINK` on each Box resolver, and `DemoLicences.openPopup` calls
  `registerPopup(label, "mumbai-01", now + 10 minutes)`.
- **The parent lock**: `SET_PARENT` and its admin are taken only for `setParent`, then revoked, on every registry
  `GameBoxNames` creates.
- **`handOverRegistrar(next)`**.
- **`setBoxKey`**: moves `addr`, `lastSeen` and `game` to the new account and revokes the old one, so `GameBoxNames`
  holds `SET_ADDRESS` on Box resolvers.
- **The wildcard default**: `gamebox.eth`'s own `PermissionedResolver`. Its default record (on the empty name `0x00`)
  holds a `url` to the claim page and a `description` saying the name is free, and no `addr`.

The 81 existing tests stay green. Then deploy v2, verify each contract on Etherscan the same way as v1, and record
everything in `deployments/sepolia.json`, replacing v1 (v1 stays on chain unused):

1. The factory, `GameBoxNames`, `PlayerStats`, `BoxResults` and `DemoLicences`, with their roles. Then the demo Box's
   `P256Account`, from its public key. Deploy scripts take `DEMO_BOX_QX` and `DEMO_BOX_QY`, never the private key.
2. `addGame("stockduel", 7 days)` and `addGame("quickdraw", 15 minutes)`.
3. Re-point `gamebox.eth`'s subregistry at the v2 registry. Deploy its wildcard resolver, write the default record,
   and set it as `gamebox.eth`'s resolver.
4. `mumbai-01`: once George has made the operator passkey (C), register it to the operator's account, with the demo
   Box's account and key and a 30-day licence. The operator's first records come from the operator site.
5. `bot.gamebox.eth`: the agent's account (from B's public key) claims it through the relayer with ERC-1271. It
   writes `agent-context` and `agent-endpoint[mcp]` (ENSIP-26) through `execute`.
6. **The hand-over, last.** Once George has made the admin passkey (C):
   - deploy the admin's account;
   - grant it `DEFAULT_ADMIN_ROLE` and `LICENSOR_ROLE` on `GameBoxNames`, and revoke both from the deployer;
   - transfer `gamebox.eth` to the admin account with `safeTransferFrom` on ETHRegistry;
   - check on chain that the deployer holds no role on anything we deployed or created, and doesn't own
     `gamebox.eth`.

   Revoke nothing on `gamebox.eth` itself.

### B. Relayer and demo Box (`names-relayer`)

- **Relayer key.** The relayer runs on the deployer's key. Set the secret this way, with no output:
  `cast wallet private-key --account sepolia-deployer --password '' | wrangler secret put RELAYER_PRIVATE_KEY`.
  Deploy scripts and the relayer share one nonce, so pause the relayer while a script broadcasts.
- **Routes:**
  - `POST /account/execute` replaces `/box/execute`. It takes a raw or WebAuthn signature from any account the factory
    made, and verifies it before spending gas.
  - It only reaches targets in `deployments/sepolia.json` or the resolvers of `*.gamebox.eth` names, and the
    `eth_call` must succeed. Rate limits are per account.
  - `POST /account/deploy` deploys a new passkey's account.
  - `/names/claim` accepts ERC-1271.
  - Everything else stays as `2-relayer.md` says, pointed at the v2 addresses.
- **The demo Box:**
  - `DEMO_BOX_P256_KEY` lives only as its Worker secret. Delete it from `.env` once it is set.
  - The heartbeat writes only `mumbai-01`; pop-ups are linked to that record.
- **The agent** lives in the demo Box Worker under `AGENT_P256_KEY`. Generate that key in a pipe straight into
  `wrangler secret put`, and print only the public key. It signs its claim and its record writes. Add `GET /agent`.
- **Clean up `.env`.** Delete `DEMO_OPERATOR_KEY` and `AGENT_PRIVATE_KEY` from `.env` and `.env.example`.

### C. The operator site (new: `apps/operator`, branch `names-operator`, Pages project `gamebox-operator`)

It uses the same stack and Schematic look as `apps/web`, and shares `packages/shared`. Give it its own README, and add
it to the layout lists in `README.md` and `CLAUDE.md`.

- **Passkeys:**
  - Create one with WebAuthn `create`: ES256, with user verification required. Read the public key from the
    attestation, and show the account address from `accountOf`.
  - Sign in with `get`.
  - Keep only the public key and the credential id in `localStorage`.
- **Operator view.** For each Box name the account owns:
  - its licence expiry, `status`, `lastSeen` and `game`;
  - a form for `commission`, `location`, `description` and `games`.

  Saving builds `executeBatch`, which is one passkey signature, and posts it to `/account/execute`. Show the
  transaction strip with Etherscan links.
- **Admin view.** It appears only when the account holds `LICENSOR_ROLE`: register, renew, set the status of, and
  rotate the key of a Box.
- **Tests:** the digest and the WebAuthn encoding against the shared vectors; the form validation; and a passkey flow
  through Playwright's CDP virtual authenticator.
- **Once it is live,** ask George to create the operator passkey and the admin passkey there. Passkeys are bound to
  that domain, so this can't happen sooner. A's steps 4 and 6 wait for them.

### D. The site (`names-site`)

Keep comp B, and switch to the v2 addresses. Add what `3-site.md` gained:

- **The claim page** shows that a free name already resolves to `gamebox.eth`'s default (wildcard).
- **Story step 4** shows the operator changing `location` on the operator site, and the change appearing on
  `mumbai-01` and its pop-ups.
- **Story step 5:** a pop-up serves `mumbai-01`'s records through the linked record. After 10 minutes it falls back
  to the parent's default.
- **The inspector:**
  - which resolver answered, and why: its own resolver, a linked record (with the name it links to and the record
    id), or the parent's by wildcard;
  - each account's kind;
  - a link to the operator site.
- **After a claim:** a QR code to the name (the ENS app if it shows our names, otherwise this site), and "Make it
  your primary name".

## Rules

- Never move ETH between wallets, and never print or log a private key or an RPC URL with its key.
- Use a 1–2 gwei tip and the explicit gas limits from the README. Keep a running ETH total.
- Docs describe the project as it is now: no mention of earlier or outside work. v1 needs no mention.
- Make small commits with the team trailers from `CLAUDE.md`, and push after each green step.

## Done when

Four PRs are open into `main`: contracts first, then the relayer, the site and the operator site, each rebased on
the contracts branch. Each PR names the files it touches outside its own folders. Merge nothing.

Then send George one short report:
- the v2 addresses, with Etherscan links;
- each account and which device holds its key;
- the hand-over transactions;
- proof that `.env` holds no private keys;
- the ETH spent;
- the live URLs;
- anything still waiting on him.
