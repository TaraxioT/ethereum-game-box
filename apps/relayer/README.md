# apps/relayer

`@egb/relayer`: a Cloudflare Worker that pays the gas for requests that are already signed (a badge's name claim, a
`P256Account`'s call, a new account's deploy, a Box-signed match result, stake or seat, a verifier-signed verdict or
void, a pop-up licence, and a badge's one drip), for the lobby's test-USDC top-ups, for refunding a pot nobody ended and
for closing a championship that has ended, and for nothing else. Live at **https://gamebox-relayer.mathew.workers.dev**.

## Routes

| Route | Takes | Checks before spending any gas | Sends |
|---|---|---|---|
| `POST /names/claim` | `{ label, badge, deadline, signature, primaryName? }` | the label rule; an unexpired deadline; the EIP-712 `ClaimName` signature: ERC-1271 `isValidSignature` if the badge has code (an agent's `P256Account` signs the digest raw), else ECDSA recovery; the badge has no name, the label is free and was never a Box; an `eth_call` of the exact call. With `primaryName: { expiry, signature }`, also: the expiry is 1 to 60 minutes away, the badge's ERC-191 signature of `primaryNameMessage`, and an `eth_call` of the registrar call | `GameBoxNames.claimPlayer`, then, once it is in a block, `DefaultReverseRegistrar.setNameForAddrWithSignature` under the same request id |
| `POST /account/execute` | `{ account, nonce, deadline, signature }` with `call: { target, value, data }` or `calls: [...]` (1 to 16) | every call is on the allowlist (below); `account` has code and is a `P256Account` that `P256AccountFactory` made (`accountOf(publicKey())`, or its `AccountDeployed` event once it has rotated its key); the signature over `Execute` (`executeDigest`, or `executeBatchDigest` for `calls`) is its key's, raw `r ‖ s` or a passkey's WebAuthn assertion with user verification, low `s` either way; a record write goes to the resolver its name has now; the nonce is unused; `eth_call` | `P256Account.execute`, or `executeBatch` |
| `POST /account/deploy` | `{ qx, qy }` | the key is a point on P-256; its account (`accountOf`) has no code yet; `eth_call` | `P256AccountFactory.deploy` |
| `POST /box/result` | `{ result, r, s }` | the Box is registered, its licence unexpired and its status `Active`; the P-256 signature over `Result` is its key's (from `GameBoxNames`); the round is new; no `/duel/open` (or refund) for the same round is pending, since a result mined before its pot leaves the pot to a refund; `eth_call` (which also names a pot that doesn't match, `PotMismatch`) | `BoxResults.submit`, which crowns the winner, records both players' stats, settles the round's pot if it has one and scores the game's open championship |
| `POST /duel/open` | `{ stake, r, s }` | the labels; `a` and `b` differ; a non-zero amount; an unexpired deadline; the Box and its signature over `Stake`, as for a result; `(box, round)` never had a pot; both players hold a player name (or the result could never settle it) and the stake in USDC; `eth_call` | `DuelPot.open`, which pulls the stake from both players |
| `POST /duel/refund` | `{ box, round }` | the label; `(box, round)` has an open pot; it opened at least `REFUND_DELAY` (an hour) ago; `eth_call` | `DuelPot.refund`, both stakes back |
| `POST /store/open` | `{ stake, r, s }`, the stake being `{ box, bundle, round, players, amount, deadline }` | the label; 2 to 4 players, none twice and none `StorePot`; a non-zero amount; an unexpired deadline; the Box and its signature over `StorePot`'s `Stake`, as for a result; the bundle is listed; `(box, round)` never had a pot; each player holds the stake in Store USDC; `eth_call` | `StorePot.open`, which pulls the stake from each player |
| `POST /store/settle` | `{ verdict, signature }`, the verdict being `{ box, round, payouts, record, deadline }` | the label; 2 to 4 payouts; an unexpired deadline; the signature over `Verdict` recovers the way OpenZeppelin's `ECDSA` recovers it (65 bytes, low `s`, `v` of 27 or 28); its signer holds `VERIFIER_ROLE` now; `(box, round)` has an open pot; a payout for each of its players, adding up to exactly the pot; `eth_call` | `StorePot.settle`, which pays `payouts[i]` to the pot's `players[i]` |
| `POST /store/void` | `{ void, signature }`, the void being `{ box, round, record, deadline }` | the label; an unexpired deadline; the signature over `Void` and its signer, as for a verdict; `(box, round)` has an open pot; `eth_call` | `StorePot.voidPot`, every stake back |
| `POST /store/refund` | `{ box, round }` | as `/duel/refund`, on `StorePot`; anyone may ask | `StorePot.refund`, every stake back |
| `POST /players/box-claim` | `{ seat, r, s }` | the labels; an unexpired deadline; the Box and its signature over `Seat`, as for a result; the badge has no name, the label is free and was never a Box (as for a claim); `eth_call` | `BoxSeats.claim`, which claims `<label>.gamebox.eth` for the badge (`claimPlayerFor`) |
| `POST /usdc/topup` | `{ player }`: an address, or an ENS name (resolved with stock viem through the Universal Resolver) | the name resolves; the player holds less than 25 USDC; `eth_call` | `FakeUSDC.mint` of 100 USDC to the player |
| `POST /store/topup` | `{ player }`, as `/usdc/topup` | as `/usdc/topup`, on Store USDC | Store USDC's `mint` of 100 USDC to the player |
| `POST /cup/close` | `{ game }` | the label; the game has an open championship; its `ends` has passed; `eth_call` | `Championships.close`: the prize to the winner, the name to the winner for good, the records frozen |
| `POST /box/popup` | `{ label }` | the label rule; `popup-<label>` is not live (`getPopup`); `eth_call` | `DemoLicences.openPopup` |
| `POST /names/drip` | `{ badge }` | the badge holds a player name, has no code (an account acts through `/account/execute` instead), never had a drip, and holds less than the drip | 0.0003 ETH to the badge |
| `GET /tx/:id` | | | the request's progress: `signed`, `sent` (the transaction's hash and its Etherscan link), `in-block` (block), `done` or `failed` (the revert by name). A claim's primary-name transaction is its `primaryName` step; the request is `done` once that step has settled too |
| `GET /health` | | | the wallet's address and balance (wei), the pending count and the head block |

The request and response types are `@egb/shared/names` `api.ts`. A POST answers `202` with the request's `TxView`. A
refusal is a 4xx `{ error, revert? }`, where `revert` names the contract error the call would revert with, decoded with
the ABIs: `400` a malformed field, label, key, amount or deadline; `401` a bad signature (including a high `s`, a wrong
passkey challenge or type, or no user verification); `403` outside the allowlist, not a factory account, not a known,
live and active Box, not a player, an unlisted bundle or a signer without `VERIFIER_ROLE`; `404` an ENS name that
doesn't resolve, or a store route before its contract is deployed; `409` taken, replayed, a used nonce, a pot that exists
or isn't open, payouts that don't fit the pot, too early, too little USDC, or already pending; `422` the `eth_call`
or the gas estimate reverts; `429` a rate limit.

The store routes answer `404` until `deployments/sepolia.json` holds `StorePot` (and Store USDC, for `/store/open` and
`/store/topup`). A round has one transaction in flight: its pot's lock is held by `/store/open`, `/store/settle`,
`/store/void` and `/store/refund`, and by the `/duel` routes and `/box/result` of the same round.

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
| result | `BoxResults.submit` (the title moves, both players' stats, the pot, the championship's records under a 3M cap) | estimate + 50%, or 2^24 + 4M if the estimate is above 1M (a v3 result's always is) |
| Box-vouched name | `BoxSeats.claim` (a new resolver) | 2^24 + 4M |
| stake, refund, top-up | `DuelPot.open`, `DuelPot.refund`, `FakeUSDC.mint` | estimate + 50% |
| store pot, store top-up | `StorePot.open`, `settle`, `voidPot`, `refund`, Store USDC's `mint` | estimate + 50% |
| championship close | `Championships.close` (the name unregistered and registered again) | 2^24 + 4M |

The live smoke test prints the gas each request used, with its Etherscan link.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: builds the routes' context from the environment |
| `src/routes.ts` | The routes and CORS (`src/cors.ts`) |
| `src/requests/` | One file per POST route (`duel.ts` holds both pot routes, `store-pot.ts` the five store routes): its checks, ending in the exact call and its gas limit. `primary-name.ts` is the claim's optional second call |
| `src/request.ts` | What the routes share: the addresses, the `eth_call`, the gas limits, the deadline check |
| `src/box.ts` | The check every Box-signed request makes: a registered, live, `Active` Box, and its key's P-256 signature |
| `src/verify.ts` | P-256 over the raw digest with a low `s`, a passkey's WebAuthn assertion, the badge's ECDSA or ERC-1271 signature, and a verifier's ECDSA signer |
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
- **Gas limits**: a call that creates a resolver, a registry or an account (`claimPlayer`, `BoxSeats.claim`,
  `openPopup`, `deploy`, `Championships.close`) is sent with `2^24 + 4M`, and so is an account's call or a result whose
  estimate is above 1M (it creates storage, which the estimate undercounts); the rest with `eth_estimateGas` plus 50%. The tip is `TIP_GWEI` (2 gwei, in `wrangler.jsonc` and if unset), the fee cap three base fees
  plus the tip, so a send lands in the next block even if the base fee climbs. Receipts are polled every 1.5 s.
- **One nonce queue**: requests are sent one at a time from the Durable Object. On a nonce error it reads the nonce
  from the chain and retries once.
- **Rate limits**: claims 5 per IP per hour and 200 per day; pop-ups 3 per IP per hour and 5 live at once; drips one
  per badge and 50 per day; account calls 30 per account per hour and 1,500 per day in all; account deploys 3 per IP
  per hour and 30 per day; top-ups one per player per 10 minutes, 60 per IP per day and 300 per day, on each token
  apart; store pots 30 per Box per hour; Box-vouched names 200 per day. Results and stakes come from known Box keys
  only, verdicts and voids from a key with `VERIFIER_ROLE`, and a refund or a close can succeed only once.
- **Done** means the head is a block past the receipt's; read at the receipt's block (`TxView.block`).
- The wallet is the deployer's (`sepolia-deployer`). It pays gas, and it is the minter of `FakeUSDC` and Store USDC, for
  the top-ups. Once the admin hand-over is done it holds no other role, but for `StorePot`'s admin and lister roles,
  which `DeployStorePot` gives it. Deploy scripts send from the same wallet and share its nonce, so the relayer is paused while a
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

The live smoke test spends about 0.03 ETH, needs the deployer at 0.5 ETH or more, and claims two names, so it counts
against the 5 claims per IP per hour (other sessions on the same machine share that window). Against the deployed Workers, or with `LIVE_DEV=1` through `wrangler dev`:

```sh
set -a; . ./.env; set +a
pnpm --filter @egb/relayer test:live
LIVE_DEV=1 pnpm --filter @egb/relayer test:live
```

`wrangler dev` reads `.dev.vars` once at start; restart it after changing them.
