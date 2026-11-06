# Prompt 2: the relayer and the demo Box

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`.

---

You are building two Cloudflare Workers for the Game Box's ENS names on Sepolia:

- **`apps/relayer`**: it pays the gas for requests that are already signed (a badge's name claim, a Box's
  `BoxAccount.execute`, a Box-signed match result, a pop-up licence), and for nothing else.
- **`apps/demo-box`**: a Box with no hardware. It has a software P-256 key, signs heartbeats and match results the
  way the Pi will, and sends them through the relayer.

Read `CLAUDE.md`, `apps/relayer/README.md`, `packages/shared/README.md` and `plan/ens/README.md` first. Prompt 1 is
building the contracts on branch `names-contracts`. Start from its first commit, which holds the interfaces,
`packages/shared/src/names/` (messages, keys, labels, ABIs) and the `ens` block of `deployments/sepolia.json`. Use
those modules and never write a digest, ABI or address yourself. If a module you need is missing there, ask for it.

Work in a new git worktree on branch `names-relayer`, cut from `names-contracts`, and rebase it as prompt 1 moves.
Don't touch the main checkout, `contracts/` or `packages/shared/`: prompt 1 owns them. Commit small, with the team
trailers from `CLAUDE.md`, push after each green step, and open a PR into `main` once prompt 1's PR is merged.

## The relayer (`apps/relayer`)

Follow the layout in its README: `index.ts`, `verify.ts`, `sender.ts` (one Durable Object per chain, one nonce queue)
and `replay.ts`. Write the routes in Hono or plain fetch handlers, whichever is smaller.

| Route | Takes | Checks before spending any gas | Sends |
|---|---|---|---|
| `POST /names/claim` | `{ label, badge, deadline, signature }` | the label rule (`labelProblem`); an unexpired deadline; the EIP-712 `ClaimName` signature recovers to `badge` (or ERC-1271 says yes); the label is free and the badge has no name; then an `eth_call` of the exact call succeeds | `GameBoxNames.claimPlayer` |
| `POST /box/execute` | `{ account, target, value, data, nonce, deadline, r, s }` | the account is a known `BoxAccount`; the P-256 signature over `Execute` matches its key; the target and selector are on the allowlist (`PermissionedResolver.setText` for `lastSeen` and `game`); `eth_call` succeeds | `BoxAccount.execute` |
| `POST /box/result` | `{ result, r, s }` | the P-256 signature over `Result` matches the Box's key from `GameBoxNames.boxKey`; the round is new; `eth_call` succeeds | `BoxResults.submit` |
| `POST /box/popup` | `{ label }` | the label rule; the pop-up label is free; `eth_call` succeeds | `DemoLicences.openPopup` |
| `POST /names/drip` | `{ badge }` | the badge holds a player name, has never had a drip, and has less than the drip amount | 0.0003 ETH to the badge. That is enough for it to send its own `revokeRoles` and a few record writes, which must come from the badge itself. Limit: one per badge, 50 per day |
| `GET /tx/:id` | | | the request's progress: `signed`, `sent` (with hash), `in-block` (with block), `done` or `failed` (with the decoded revert name) |
| `GET /health` | | | the wallet balance, the pending count and the head block |

Rules:

- **Gas.** Gas is spent only after every check passes. A forged or replayed request costs nothing and gets a 4xx
  with its reason. Name the revert by its error name, decoded with the ABIs.
- **Sending.**
  - Use the explicit gas limits from `plan/ens/README.md` and a configured tip (`TIP_GWEI`, default 2).
  - Run one nonce queue in the Durable Object. On a nonce error, resync and retry once.
  - After a receipt, reads go to the receipt's block.
- **Rate limits** (Durable Object counters): claims at 5 per IP per hour and 200 per day in total. Pop-ups at 3 per IP
  per hour, and only 5 can be live at once. Results and executes come from known Box keys only.
- **Wallet.** It never holds a role. Secrets (`RELAYER_PRIVATE_KEY` from the `sepolia-relayer` keystore, and the RPC
  URL) are set with `wrangler secret put`, never committed. Errors never echo the RPC URL.
- **CORS.** Allow only the site's origin and `localhost` in dev.

## The demo Box (`apps/demo-box`)

It does what the Pi will do, with a software key in place of the HYP2003 token. Its secrets are
`DEMO_BOX_P256_KEY` and the relayer URL.

- **Heartbeat.** A Durable Object alarm every 5 minutes signs a `BoxAccount.execute` that writes `lastSeen` (unix
  seconds) and `game` on `mumbai-01.gamebox.eth`, and sends it through `POST /box/execute`. Pop-up names are linked
  to `mumbai-01`'s record, so they show the same heartbeat with no extra write.
- **`POST /result`.** Takes `{ box, game, winner, loser, draw }`, picks the next round number, signs a `Result` with
  P-256, sends it through `POST /box/result`, and returns the relayer's request id.
  - This is the site's "who won" button. On the site it is labelled for what it is: the demo Box, with a software
    key, reports the result. At the event, the Box signs only after a real match.
  - Rate limit: 10 per IP per hour.
- **`GET /box`.** The Box's label, its account, its public key (`qx`, `qy`) and its last heartbeat.
- The P-256 signing uses Web Crypto (ECDSA P-256 over the EIP-712 digest, with `s` normalised to low-s). A test
  checks it against the contract's verification, using the digest vectors in `packages/shared`.

## Tests (Vitest, `@cloudflare/vitest-pool-workers` where a Worker runtime is needed)

- **Every refusal**: a bad label, an expired deadline, the wrong signer, a high `s`, a replayed digest, a target or
  selector outside the allowlist, an exceeded rate limit, and an `eth_call` revert (passed on with its error name).
  None of these sends a transaction. Assert it with a mocked client that records sends.
- **The nonce queue**: two parallel requests get consecutive nonces, and a nonce error resyncs.
- **The demo Box**: the heartbeat signs the right digest, and a result's round numbers never repeat.
- **One live smoke test against Sepolia**, behind `LIVE=1`. Through `wrangler dev`, it claims a fresh test name,
  sends a heartbeat, opens a pop-up and reports a result. It checks each through the Universal Resolver with stock
  viem, and prints the Etherscan links.

## Deploy

- Deploy both Workers with `wrangler deploy` to the Cloudflare account that hosts `ethereum-game-box.pages.dev` (check
  with `wrangler whoami`).
- Set the secrets. `/health` must show the relayer funded (George funds `sepolia-relayer` to 0.2 ETH; if it is lower,
  say so and stop before the live test).
- Write both URLs to `apps/relayer/README.md` and `apps/demo-box/README.md`, and give them to the site's session.
- Add `apps/demo-box/` to the layout lists in `README.md` and `CLAUDE.md`, with a README of its own like every other
  folder.
- Hand the `mumbai-01` heartbeat over from the deployer to the demo Box.

## Done when

`pnpm typecheck` and `pnpm test` pass, the live smoke test passes against the deployed Workers, and the PR lists the
transactions it made, with Etherscan links.
