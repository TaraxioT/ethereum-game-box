# The chain port

The core's `ChainPort` (`core/ports.ts`) on Sepolia, for the Box server. Stakes are fake USDC (`FakeUSDC`, 6 decimals);
every address comes from `deployments/sepolia.json` through `@egb/shared/names`. The relayer
(`RELAYER_URL`, `apps/relayer`) sends each request and pays the gas; the Box signs what needs its say with its P-256
key (`src/signer/`), and holds no Ethereum key for any of this. (The optional admin key, `EGB_ADMIN_KEY`, is only
for the test page's Admin tab: `server/admin.ts`.)

| Request | Route | Signed by the Box |
|---|---|---|
| Both stakes into the pot | `POST /duel/open { stake, r, s }` | `Stake` ("Game Box Stakes" v1, `DuelPot`) |
| The result, which settles the pot | `POST /box/result { result, r, s }` | `Result` ("Game Box Results" v1, `BoxResults`), the stake's round and badges |
| An unsettled pot back to both | `POST /duel/refund { box, round }` | no (anyone, an hour after the open) |
| 100 USDC to a badge | `POST /usdc/topup { player }` | no |
| A player name for a badge | `POST /players/box-claim { seat, r, s }` | `Seat` ("Game Box Seats" v1, `BoxSeats`): a HaLo badge can't sign a `ClaimName` |
| A store game's stakes into its pot | `POST /store/open { stake, r, s }` | `Stake` ("Game Box Store Pots" v1, `StorePot`), naming the bundle's hash |
| An unsettled store pot back to its players | `POST /store/refund { box, round }` | no (anyone, an hour after the open) |
| 100 Store USDC to a badge | `POST /store/topup { player }` | no |

At start the server logs whether the signer's key is the one `GameBoxNames` holds for `EGB_BOX` (`checkKey`): if not,
the relayer refuses every request. Every request is followed on `GET /tx/:id` every second until `done` (the tx bar's `paid`) or `failed`, and each step,
with the real hash and its Etherscan link, goes to the core's watch. A refusal (a 4xx with the contract's error) fails
the request at once. Deadlines are 10 minutes.

The core sends a result only once its pot's open is done, so the pot is there to settle. Rounds live in
`$EGB_DATA/rounds.json`, written synchronously before a round is used, so none repeats; at start the server moves past
any round the chain has seen. The file also keeps each pot the Box opened until it settles or is refunded, and every 5
minutes the server refunds any past its delay (a match lost to a restart or a reset). Only a definite refusal of its
open (a 4xx, or a key that can't sign) takes a pot off the file at once. Any other failed open may have landed (its
answer was lost, or the relayer went quiet), so it stays, and the sweep refunds it, or drops it if the chain has no such
pot. Store pots share the rounds, and the file keeps them apart (`storePots`, left out while there are none), so the
sweep refunds each through its own route.

## Store games

`store.ts` is the port's `store`, there once `StorePot` is deployed and `EGB_VERIFIER_URL` is set. Stakes are Store USDC,
a second `FakeUSDC`.

A closed match goes to the verifier (`EGB_VERIFIER_URL`, `apps/verifier`), not the relayer: the Box writes the `MatchLog`
from the core's entries, signs a `Judge` ("Game Box Verifier" v1, its verifying contract the `StorePot`) over the
keccak256 of its exact JSON text, and sends that same text to `POST /judge`. A verifier that is down or busy gets it
again after 5 seconds, then doubling up to every 2 minutes (a try can use up one of the judgements it allows a Box in an
hour), each try signed afresh, as a long outage outlasts a deadline. Then `GET /judge/<box>/<round>` is followed every 2
seconds to `paid`, `refunded` or `failed`. Failed, a refusal, or 30 minutes with no end to it (`JUDGE_GIVE_UP_MS`, past
the verifier's two runs and its payment) go to the core's Refund. Only the chain pays: what the verifier says is shown,
and it can't move a stake or end a pot. Whatever it says, the round stays on the file for the sweep, which reads the
chain: it forgets a pot that is over, and refunds one that isn't.

Reads go to `SEPOLIA_RPC_URL`: USDC balances, `GameBoxNames.nameOf`, the pot and rounds, the head for the block clock,
and through the Universal Resolver a player's `stats`, a game's title (`champion.<game>.gamebox.eth`: `addr`, `streak`),
its open cup (`Championships.openCup`, then its name's `standings`) and `gamebox.eth`'s `leaderboard`. After a result is
paid, its lines are read at the receipt's block: the `PotSettled` payout, whether the winner now holds the title, each
player's place in the cup, and each player's new `stats`.
The RPC URL carries the node's key, so every error that leaves `reads.ts` has its URLs replaced by `<rpc>`.

## Modules

| Module | What it is | API |
|---|---|---|
| `port.ts` | The port: requests, rounds, the sweep, the result's lines | `createSepoliaChain(options)`, `stakeOf`, `resultOf`, `seatOf`, `outcomeLines` |
| `requests.ts` | A request through the relayer: signed, sent and followed to its end | `createRequests(options)`, `RequestEnd`, `POLL_MS`, `GIVE_UP_MS` |
| `store.ts` | The port's `store`: `StorePot`, Store USDC and the judge | `createStoreChain(options)`, `storeStakeOf`, `matchLogOf`, `JUDGE_POLL_MS`, `JUDGE_RETRY_MS`, `JUDGE_RETRY_MAX_MS`, `JUDGE_GIVE_UP_MS` |
| `verifier.ts` | The verifier's HTTP API, its answers checked | `verifierAt(url)`, `parseStatus` |
| `relayer.ts` | The relayer's HTTP API: POSTs answered with a `TxView` or an error | `relayerAt(url)` |
| `reads.ts` | Sepolia reads, URLs redacted from every error | `sepoliaReads(rpcUrl)`, `redact` |
| `rounds.ts` | `rounds.json`: the next round and the open pots | `roundsFile(file)` |
| `testing.ts` | For tests: a relayer that records and answers from a script, reads in memory, a verifier told what to say | `mockRelayer`, `memoryReads`, `mockVerifier` |

Tests: `port.test.ts` checks the `Stake`, `Result` and `Seat` the Box signs against the shared digest vectors byte for
byte (and each posted signature against the vector key), every route's body, the steps to paid or failed, a refusal, an
open that may have landed, a key that can't sign, the rounds across a restart, the sweep and the result's lines.
`store.test.ts` does the same for a store game: `Stake` and `Judge` against the store's vectors, every route's body, each
way an open may have landed, the verifier followed to each end, a refusal, an outage with its backoff and fresh
deadlines, one that never answers, and its HTTP API. `server/chain-match.test.ts` plays a whole match through this port on the Box server, and
`server/store-match.test.ts` a store game's. Those stand in a mock relayer that takes any body, so `relayer.test.ts` puts a
store game's open, refund and top-up through the relayer's real routes, signed by the real signer. It has its own
`tsconfig.relayer.json`: those routes need the Workers' types, and the Box's own code must not get them.
