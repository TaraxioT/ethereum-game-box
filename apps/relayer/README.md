# apps/relayer

`@egb/relayer`: a Cloudflare Worker that pays the gas for requests that are already signed (a badge's name claim, a
Box's `BoxAccount.execute`, a Box-signed match result, a pop-up licence, and a badge's one drip), and for nothing
else. Live at **https://gamebox-relayer.mathew.workers.dev**.

## Routes

| Route | Takes | Checks before spending any gas | Sends |
|---|---|---|---|
| `POST /names/claim` | `{ label, badge, deadline, signature, primaryName? }` | the label rule; an unexpired deadline; the EIP-712 `ClaimName` signature recovers to `badge` (or ERC-1271 says yes); the badge has no name, the label is free and was never a Box; an `eth_call` of the exact call. With `primaryName: { expiry, signature }`, also: the expiry is 1 to 60 minutes away, the badge's ERC-191 signature of `primaryNameMessage` recovers to it, and an `eth_call` of the registrar call | `GameBoxNames.claimPlayer`, then, once it is in a block, `DefaultReverseRegistrar.setNameForAddrWithSignature` under the same request id |
| `POST /box/execute` | `{ account, target, value, data, nonce, deadline, r, s }` | the call is `PermissionedResolver.setText` of `lastSeen` or `game` on a `<box>.gamebox.eth` name; `account` is that Box's `BoxAccount` and `target` its resolver; the licence is live; the P-256 signature over `Execute` matches the Box's key; `eth_call` | `BoxAccount.execute` |
| `POST /box/result` | `{ result, r, s }` | the P-256 signature over `Result` matches the Box's key from `GameBoxNames`; the round is new; `eth_call` | `BoxResults.submit` |
| `POST /box/popup` | `{ label }` | the label rule; `popup-<label>` is not live; `eth_call` | `DemoLicences.openPopup` |
| `POST /names/drip` | `{ badge }` | the badge holds a player name, never had a drip, and holds less than the drip | 0.0003 ETH to the badge |
| `GET /tx/:id` | | | the request's progress: `signed`, `sent` (hash), `in-block` (block), `done` or `failed` (the revert by name). A claim's primary-name transaction is its `primaryName` step; the request is `done` once that step has settled too |
| `GET /health` | | | the wallet's address and balance (wei), the pending count and the head block |

The request and response types are `@egb/shared/names` `api.ts`. A POST answers `202` with the request's `TxView`. A
refusal is a 4xx `{ error, revert? }`, where `revert` names the contract error, decoded with the ABIs: `400` a
malformed field, label or deadline; `401` a bad signature (including a high `s`); `403` outside the allowlist or not
a known Box; `409` taken, replayed or already pending; `422` the `eth_call` reverts; `429` a rate limit.

## Measured gas (Sepolia)

| Request | Call | Gas used | Limit sent |
|---|---|---|---|
| claim | `GameBoxNames.claimPlayer` (a new resolver) | 2,117,302 | 2^24 + 4M |
| claim's primary name | `DefaultReverseRegistrar.setNameForAddrWithSignature` | 139,348 | estimate + 50% |
| pop-up | `DemoLicences.openPopup` (a new resolver) | 4,773,300 | 2^24 + 4M |
| result | `BoxResults.submit` (the title moves, both players' stats) | 3,071,973 | estimate + 50% |
| heartbeat | `BoxAccount.execute` → `setText(lastSeen)` | 182,050 (280,013 on a name's first) | estimate + 50% |
| heartbeat | `BoxAccount.execute` → `setText(game)` | 171,985 (279,929 on a name's first) | estimate + 50% |

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: builds the routes' context from the environment |
| `src/routes.ts` | The routes and CORS (`src/cors.ts`) |
| `src/requests/` | One file per POST route: its checks, ending in the exact call and its gas limit. `primary-name.ts` is the claim's optional second call |
| `src/request.ts` | What the routes share: the `eth_call`, the gas limits, the deadline check |
| `src/verify.ts` | P-256 over the raw digest with a low `s`, and the badge's ECDSA or ERC-1271 signature |
| `src/allowlist.ts` | The only calls a Box may have relayed through `execute` |
| `src/revert.ts` | Names a revert by its contract error |
| `src/sender.ts` | The `Sender` Durable Object, one per chain: one nonce queue, the request records, receipts polled by alarm |
| `src/replay.ts` | Refuses a digest it has already sent |
| `src/limits.ts` | The rate limits, as sliding windows in the Durable Object |
| `test/` | Every refusal against a fake node that records sends, the nonce queue, the P-256 vectors |
| `test/live/` | The smoke test against Sepolia |

## Rules

- **Gas** is spent only after every check passes. A forged or replayed request costs nothing.
- **Gas limits**: a call that creates a resolver (`claimPlayer`, `openPopup`) is sent with `2^24 + 4M`; the rest with
  `eth_estimateGas` plus 50%. The tip is `TIP_GWEI` (1 in `wrangler.jsonc`; 2 if unset), the fee cap twice the base fee
  plus the tip.
- **One nonce queue**: requests are sent one at a time from the Durable Object. On a nonce error it reads the nonce
  from the chain and retries once.
- **Rate limits**: claims 5 per IP per hour and 200 per day; pop-ups 3 per IP per hour and 5 live at once; drips one
  per badge and 50 per day. Results and executes come from known Box keys only.
- **Done** means the head is a block past the receipt's; read at the receipt's block (`TxView.block`).
- The wallet (`sepolia-relayer`) holds gas only. It is never the deployer, never a Box, and holds no role.
- Errors never echo the RPC URL: it carries the API key. Every URL in an error becomes `<rpc>`.
- CORS allows only `https://gamebox-names.pages.dev` (and `http://localhost:*` in dev). Requests without an
  `Origin` (the demo Box) pass.

## Run

```sh
pnpm --filter @egb/relayer test                 # unit tests, no network
cp apps/relayer/.dev.vars.example apps/relayer/.dev.vars && pnpm --filter @egb/relayer dev
```

Deploy, then set the secrets (the key goes from the keystore straight into Wrangler, never through the terminal):

```sh
cd apps/relayer && wrangler deploy
cast wallet private-key --account sepolia-relayer --password '' | wrangler secret put RELAYER_PRIVATE_KEY
printf %s "$SEPOLIA_RPC_URL" | wrangler secret put SEPOLIA_RPC_URL
```

The live smoke test spends about 0.02 ETH. Against the deployed Workers, or with `LIVE_DEV=1` through `wrangler dev`:

```sh
set -a; . ./.env; set +a
pnpm --filter @egb/relayer test:live
LIVE_DEV=1 pnpm --filter @egb/relayer test:live
```

`wrangler dev` reads `.dev.vars` once at start; restart it after changing them.
