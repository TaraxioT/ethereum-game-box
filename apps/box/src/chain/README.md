# The chain port

The core's `ChainPort` (`core/ports.ts`) on Sepolia, for the Box server. Stakes are fake USDC (`FakeUSDC`, 6 decimals);
every address comes from `deployments/sepolia.json` through `@egb/shared/names`. The relayer
(`RELAYER_URL`, `apps/relayer`) sends each request and pays the gas; the Box signs what needs its say with its P-256
key (`src/signer/`), and never holds an Ethereum key.

| Request | Route | Signed by the Box |
|---|---|---|
| Both stakes into the pot | `POST /duel/open { stake, r, s }` | `Stake` ("Game Box Stakes" v1, `DuelPot`) |
| The result, which settles the pot | `POST /box/result { result, r, s }` | `Result` ("Game Box Results" v1, `BoxResults`), the stake's round and badges |
| An unsettled pot back to both | `POST /duel/refund { box, round }` | no (anyone, an hour after the open) |
| 100 USDC to a badge | `POST /usdc/topup { player }` | no |
| A player name for a badge | `POST /players/box-claim { seat, r, s }` | `Seat` ("Game Box Seats" v1, `BoxSeats`): a HaLo badge can't sign a `ClaimName` |

At start the server logs whether the signer's key is the one `GameBoxNames` holds for `EGB_BOX` (`checkKey`): if not,
the relayer refuses every request. Every request is followed on `GET /tx/:id` every 3 s until `done` (the tx bar's `paid`) or `failed`, and each step,
with the real hash and its Etherscan link, goes to the core's watch. A refusal (a 4xx with the contract's error) fails
the request at once. Deadlines are 10 minutes.

The core sends a result only once its pot's open is done, so the pot is there to settle. Rounds live in
`$EGB_DATA/rounds.json`, written synchronously before a round is used, so none repeats; at start the server moves past
any round the chain has seen. The file also keeps each pot the Box opened until it settles or is refunded, and every 5
minutes the server refunds any past its delay (a match lost to a restart or a reset).

Reads go to `SEPOLIA_RPC_URL`: USDC balances, `GameBoxNames.nameOf`, the pot and rounds, the head for the block clock,
and a game's title (`champion.<game>.gamebox.eth`: `addr`, `streak`) and open championship (`Championships.openCup`, then
its name's `standings`) through the Universal Resolver. After a result is paid, its lines are read at the receipt's
block: the `PotSettled` payout, whether the winner now holds the title, and each player's place in the championship.
The RPC URL carries the node's key, so every error that leaves `reads.ts` has its URLs replaced by `<rpc>`.

## Modules

| Module | What it is | API |
|---|---|---|
| `port.ts` | The port: requests, their steps, rounds, the sweep, the result's lines | `createSepoliaChain(options)`, `stakeOf`, `resultOf`, `seatOf`, `outcomeLines` |
| `relayer.ts` | The relayer's HTTP API: POSTs answered with a `TxView` or an error | `relayerAt(url)` |
| `reads.ts` | Sepolia reads, URLs redacted from every error | `sepoliaReads(rpcUrl)`, `redact` |
| `rounds.ts` | `rounds.json`: the next round and the open pots | `roundsFile(file)` |
| `testing.ts` | For tests: a relayer that records and answers from a script, reads in memory | `mockRelayer`, `memoryReads` |

Tests: `port.test.ts` checks the `Stake`, `Result` and `Seat` the Box signs against the shared digest vectors byte for
byte (and each posted signature against the vector key), every route's body, the steps to paid or failed, a refusal, a
key that can't sign, the rounds across a restart, the sweep and the result's lines. `server/chain-match.test.ts` plays a
whole match through this port on the Box server.
