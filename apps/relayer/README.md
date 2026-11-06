# apps/relayer

`@egb/relayer`: a Cloudflare Worker that pays the gas for requests that are already signed (a badge's name claim, a
`P256Account`'s call, a new account's deploy, a Box-signed match result, a pop-up licence, and a badge's one drip), and
for nothing else. Live at **https://gamebox-relayer.mathew.workers.dev**.

## Routes

| Route | Takes | Checks before spending any gas | Sends |
|---|---|---|---|
| `POST /names/claim` | `{ label, badge, deadline, signature, primaryName? }` | the label rule; an unexpired deadline; the EIP-712 `ClaimName` signature: ERC-1271 `isValidSignature` if the badge has code (an agent's `P256Account` signs the digest raw), else ECDSA recovery; the badge has no name, the label is free and was never a Box; an `eth_call` of the exact call. With `primaryName: { expiry, signature }`, also: the expiry is 1 to 60 minutes away, the badge's ERC-191 signature of `primaryNameMessage`, and an `eth_call` of the registrar call | `GameBoxNames.claimPlayer`, then, once it is in a block, `DefaultReverseRegistrar.setNameForAddrWithSignature` under the same request id |
| `POST /account/execute` | `{ account, nonce, deadline, signature }` with `call: { target, value, data }` or `calls: [...]` (1 to 16) | every call is on the allowlist (below); `account` has code and is a `P256Account` that `P256AccountFactory` made (`accountOf(publicKey())`, or its `AccountDeployed` event once it has rotated its key); the signature over `Execute` (`executeDigest`, or `executeBatchDigest` for `calls`) is its key's, raw `r ‖ s` or a passkey's WebAuthn assertion with user verification, low `s` either way; a record write goes to the resolver its name has now; the nonce is unused; `eth_call` | `P256Account.execute`, or `executeBatch` |
| `POST /account/deploy` | `{ qx, qy }` | the key is a point on P-256; its account (`accountOf`) has no code yet; `eth_call` | `P256AccountFactory.deploy` |
| `POST /box/result` | `{ result, r, s }` | the P-256 signature over `Result` matches the Box's key from `GameBoxNames`; the round is new; `eth_call` | `BoxResults.submit` |
| `POST /box/popup` | `{ label }` | the label rule; `popup-<label>` is not live (`getPopup`); `eth_call` | `DemoLicences.openPopup` |
| `POST /names/drip` | `{ badge }` | the badge holds a player name, has no code (an account acts through `/account/execute` instead), never had a drip, and holds less than the drip | 0.0003 ETH to the badge |
| `GET /tx/:id` | | | the request's progress: `signed`, `sent` (hash), `in-block` (block), `done` or `failed` (the revert by name). A claim's primary-name transaction is its `primaryName` step; the request is `done` once that step has settled too |
| `GET /health` | | | the wallet's address and balance (wei), the pending count and the head block |

The request and response types are `@egb/shared/names` `api.ts`. A POST answers `202` with the request's `TxView`. A
refusal is a 4xx `{ error, revert? }`, where `revert` names the contract error, decoded with the ABIs: `400` a
malformed field, label, key or deadline; `401` a bad signature (including a high `s`, a wrong passkey challenge or
type, or no user verification); `403` outside the allowlist, not a factory account, or not a known Box; `409` taken,
replayed, a used nonce, or already pending; `422` the `eth_call` reverts; `429` a rate limit.

### The account allowlist

An account's calls (each call of a batch) may be:

- any call to a contract in `deployments/sepolia.json`: ours, ENS's, and the proxies `GameBoxNames` created;
- a record write (`setText`, `setAddress`, `linkToNode`, `linkToRecord`) on a `<label>.gamebox.eth` name, sent to
  the resolver that name has in `gamebox.eth`'s registry. This is how a Box writes `lastSeen` and `game`, an operator
  its four keys, and the agent its ENSIP-26 records; each resolver's own roles decide which keys each may write;
- `rotateKey` on the account itself, to a point on P-256.

No call may send ETH. Whatever the call, its `eth_call` must succeed.

## Gas limits

| Request | Call | Limit sent |
|---|---|---|
| claim | `GameBoxNames.claimPlayer` (a new resolver) | 2^24 + 4M |
| claim's primary name | `DefaultReverseRegistrar.setNameForAddrWithSignature` | estimate + 50% |
| account deploy | `P256AccountFactory.deploy` (new code) | 2^24 + 4M |
| account call | `P256Account.execute` / `executeBatch` | estimate + 50%, or 2^24 + 4M if the estimate is above 1M |
| pop-up | `DemoLicences.openPopup` (a new name, linked to its Box's record) | 2^24 + 4M |
| result | `BoxResults.submit` (the title moves, both players' stats) | estimate + 50% |

The live smoke test prints the gas each request used, with its Etherscan link.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: builds the routes' context from the environment |
| `src/routes.ts` | The routes and CORS (`src/cors.ts`) |
| `src/requests/` | One file per POST route: its checks, ending in the exact call and its gas limit. `primary-name.ts` is the claim's optional second call |
| `src/request.ts` | What the routes share: the addresses, the `eth_call`, the gas limits, the deadline check |
| `src/verify.ts` | P-256 over the raw digest with a low `s`, a passkey's WebAuthn assertion, and the badge's ECDSA or ERC-1271 signature |
| `src/account.ts` | Whether an account is a `P256Account` the factory made, and its current key |
| `src/allowlist.ts` | The only calls an account may have relayed through `execute` |
| `src/targets.ts` | Every address in `deployments/sepolia.json` |
| `src/revert.ts` | Names a revert by its contract error |
| `src/sender.ts` | The `Sender` Durable Object, one per chain: one nonce queue, the request records, receipts polled by alarm |
| `src/replay.ts` | Refuses a digest it has already sent |
| `src/limits.ts` | The rate limits, as sliding windows in the Durable Object |
| `test/` | Every refusal against a fake node that records sends, the nonce queue, the P-256 and WebAuthn vectors |
| `test/live/` | The smoke test against Sepolia |

## Rules

- **Gas** is spent only after every check passes. A forged or replayed request costs nothing.
- **Gas limits**: a call that creates a resolver, a registry or an account (`claimPlayer`, `openPopup`, `deploy`) is
  sent with `2^24 + 4M`, and so is an account's call whose estimate is above 1M (it creates storage, which the
  estimate undercounts); the rest with `eth_estimateGas` plus 50%. The tip is `TIP_GWEI` (1 in `wrangler.jsonc`; 2 if unset), the fee cap twice the base fee
  plus the tip.
- **One nonce queue**: requests are sent one at a time from the Durable Object. On a nonce error it reads the nonce
  from the chain and retries once.
- **Rate limits**: claims 5 per IP per hour and 200 per day; pop-ups 3 per IP per hour and 5 live at once; drips one
  per badge and 50 per day; account calls 30 per account per hour and 1,500 per day in all; account deploys 3 per IP
  per hour and 30 per day. Results come from known Box keys only.
- **Done** means the head is a block past the receipt's; read at the receipt's block (`TxView.block`).
- The wallet is the deployer's (`sepolia-deployer`). It pays gas, and once the admin hand-over is done it holds no
  role on anything. Deploy scripts send from the same wallet and share its nonce, so the relayer is paused while a
  script broadcasts.
- Errors never echo the RPC URL: it carries the API key. Every URL in an error becomes `<rpc>`.
- CORS allows only the names site `https://gamebox-names.pages.dev` and the operator site `https://gamebox-operator.pages.dev` (and `http://localhost:*` in dev). Requests without an
  `Origin` (the demo Box) pass.

## Run

```sh
pnpm --filter @egb/relayer test                 # unit tests, no network
cp apps/relayer/.dev.vars.example apps/relayer/.dev.vars && pnpm --filter @egb/relayer dev
```

Deploy, then set the secrets (the key goes from the keystore straight into Wrangler, never through the terminal):

```sh
cd apps/relayer && wrangler deploy
cast wallet private-key --account sepolia-deployer --password '' | wrangler secret put RELAYER_PRIVATE_KEY
printf %s "$SEPOLIA_RPC_URL" | wrangler secret put SEPOLIA_RPC_URL
```

The live smoke test spends about 0.02 ETH. Against the deployed Workers, or with `LIVE_DEV=1` through `wrangler dev`:

```sh
set -a; . ./.env; set +a
pnpm --filter @egb/relayer test:live
LIVE_DEV=1 pnpm --filter @egb/relayer test:live
```

`wrangler dev` reads `.dev.vars` once at start; restart it after changing them.
