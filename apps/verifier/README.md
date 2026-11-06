# apps/verifier

`@egb/verifier`: the Worker that judges a store game. It takes a match's log, has an agent read it in a container, and
signs who gets paid how much. If it can't, it signs every stake back. It holds every key. The plan is
[`plan/game-store.md`](../../plan/game-store.md).

The agent's code is [`container/`](container/README.md). The rest of this folder is the Worker, `gamebox-verifier`.

## Routes

| Route | Takes | Answers |
|---|---|---|
| `POST /judge` | `JudgeRequest` | `202` with a `JudgeStatus` for a new judgement, `200` for a repeat of the same log |
| `GET /judge/<box>/<round>` | | `JudgeStatus`, or `404` |
| `GET /audit/<box>/<round>` | | `{ record, root, tx }`: the record's hash, and its root and transaction on 0G Storage, null until it lands |
| `GET /health` | | `{ verifier }`: the verifier key's address |

The types are `@egb/shared/store`. A refusal is `{ error }`, with the relayer's codes: `400` a bad field or log, `401` a
bad signature, `403` a Box that isn't known, live and active, `404` no such bundle, `409` a pot that isn't open or
doesn't match the log, or a second log for a pot, `413` a body over 3 MiB, `422` a zip that isn't the bundle staked on,
`429` a rate limit. `502` means something upstream failed and the Box can repeat it. `503` means `StorePot` isn't deployed
yet.

## One judgement

`POST /judge` checks, in this order, and starts nothing until all of them pass:

1. The body, and `logTextProblems` on the log's exact text. A log over 1 MiB is refused before parsing, and one with a
   repeated key is refused, as it would read two ways.
2. The deadline, and the Box's P-256 signature over `Judge`, against `GameBoxNames.getBox`, as the relayer checks it. That
   reads the chain for anyone who asks, signed or not, so 600 requests an hour from one address get that far.
3. Whether this pot already has a judgement. The same log gets the running one back, and another log is refused.
4. The Box's rate limit: 60 new judgements an hour. It counts only requests the Box signed. A request that then fails
   upstream gives its count back, so a Box repeating a `502` through an outage uses none of it. A refusal keeps its count.
5. The pot, read from `StorePot`: open, with the same players in the same order, amount and bundle as the log's header.
6. The zip from the store, by hash. The reader and the hash must pass, and the manifest's id must be the log's game. The
   instructions come from here, never from the Box.

Then the pot's Durable Object takes over, and its alarm does the rest:

1. **Run.** A fresh container gets `POST /run`. Each attempt is a new container Durable Object, `<box>:<round>:<attempt>`.
   With every container taken the run never started, so it costs no attempt: it waits, from 5 seconds doubling up to a
   minute, for 10 minutes in all across the pot's runs. After that, no free container counts as a failed run, so a full
   pool can't outlast the refund.
2. **Weigh.** A failure is a timeout, 0G unreachable, a turn the TEE check refuses, `cannot_judge`, or a verdict that
   doesn't pay each player a whole number adding up to exactly the pot. A failed first run gets one retry.
3. **Seal.** The Worker builds the `AuditRecord`, once, and keeps its exact text. Its keccak256 goes in the message.
4. **Sign and send.** A `Verdict`, or a `Void` after two failed runs, goes to the relayer's `/store/settle` or
   `/store/void`. It tries for two hours, then says `failed`, and the pot waits for its refund.
5. **Close.** The pot's state on chain decides `paid` or `refunded`, whoever closed it.
6. **Keep.** Only then does the record go to 0G Storage, so an upload can't hold up a payment. It is retried for as long
   as it takes, an hour apart at most, and kept in the Durable Object until it lands.

## Why it can't pay twice

- `StorePot` takes one `settle` or `voidPot` per pot, and the Durable Object keeps one judgement per pot.
- Every step is saved before the one it protects. A record is saved before it is signed, and a signature before it is
  sent, so an alarm that dies at any line runs again and sends the same bytes.
- A run still marked as running when the object wakes counts as failed. The next run gets a fresh container, and a call
  from the old one is refused. After a crash mid-run, the alarm set before it wakes the object within 9 minutes.
- The split and the record never change once sealed. A signature is only renewed for a new deadline.

## The container's one way out

`AgentContainer` sets `enableInternet = false`, and its only outbound handler is for the host `zg.internal`. With only
`outboundByHost` set, no other name resolves. The handler runs here in the Worker, and each container's ticket is kept in
its own Durable Object, so the code inside can't claim to be another run.

`outboundByHost` is assigned after the class, as Cloudflare's docs do. A `static` field, as the package's README shows,
would shadow the setter that registers the handler, and every call would be refused.

The handler counts a call's bytes as they arrive and stops at 1 MiB, so a shell streaming at it can't fill the Worker's
memory. `POST /judge` reads its body the same way, with a limit of 3 MiB.

`src/proxy.ts` is the model's only caller. It keeps the fields a chat needs, sets `model`, `max_tokens`, `verify_tee: true`
and the header `X-0G-Provider-Trust-Mode: private` itself, and records each turn as an `AgentTurn`.

An agent's shell can reach `zg.internal` as well as its loop can, so these limits hold here too, whatever the container
does. Each is checked before a call goes out, and passing one fails the run:

| Limit | Value | Counted |
|---|---|---|
| Turns | 16 a run | Each call to 0G |
| Tokens | 200,000 a run | Each reply's `usage.total_tokens`, and each prompt at three bytes a token before it goes |
| Size | 4 MiB a pot, over both runs | Each recorded turn. Sealing a record holds it a few times over at once, so this stays far under a Durable Object's 128 MB |

## The TEE check

Mainnet's replies carry no `tee_verified`, even with `verify_tee: true`. So every turn goes through a `TeeCheck`, and
`SignedChatCheck` in `src/tee.ts` does this:

1. The reply has `X-0g-E2ee: sealed`, a `Zg-Res-Key` (its chat id) and `x_0g_trace.provider`.
2. 0G's serving contract, read with viem, lists that provider as `TeeML`, with its enclave key acknowledged.
3. The provider's signature endpoint has a signature for the chat, and it recovers (EIP-191) to that key.

The chat id, provider, text and signature go in the turn, so anyone can recheck it. A turn that fails fails the run, and
its reply never reaches the agent. `AgentTurn.teeVerified` is true only for a turn that passed.

A turn has one deadline, 55 seconds, for 0G's reply and this check together. The container gives its whole call to
`zg.internal` 60, so a turn that passes always gets back to it, and one that doesn't is recorded here as a failure, not
lost when the container gives up.

**What this doesn't prove.** The signed text is `zg-sig-v1/e2ee-ct:<hash>:<hash>`, two hashes of ciphertext we never hold
and can't recompute. It proves that a registered, attested enclave handled this chat id. It doesn't bind the prompt or
the reply's text to the signature, and 0G's own SDK check doesn't either. Say "each turn passed an attested enclave".

## 0G Storage runs in the Worker

A real `wrangler deploy --dry-run` bundles the SDK, and it ran a whole upload in workerd against the fake. So there's no
second container. It needs one change: the SDK's RPC goes through an old axios that asks for `XMLHttpRequest`, which
fails in a Worker, so `src/zg-storage.ts` gives its indexer and node clients a `fetch` transport. That transport also
carries the timeout, because the SDK waits for a node to sync in a loop with no end.

The upload retries for ever, so it mustn't pay each time. `skipTx` isn't enough: the SDK reads a failed `zgs_getFileInfo`
as "no such file", a node says the same until it has synced a payment, and either way the SDK pays. So:

- A payment is saved in the Durable Object the moment it leaves the wallet.
- Before each try, the file is read from the node where a failure throws, so a node that can't answer costs nothing.
- With no file and a payment that is mined or pending, the try ends and waits for the node. Only one that reverted or
  vanished is paid again.
- A try that finds the file gets a wallet that refuses to send, so the SDK's own read failing can't pay either.

The one gap: a Durable Object that dies between the send and the save forgets that payment. The file read still stops a
second one once the node has synced it.

The uploads pay in 0G on 0G's chain. That and the provider reads are the only use of a chain other than Sepolia.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: builds the routes from the environment |
| `src/routes.ts`, `src/admit.ts` | The HTTP routes, and `POST /judge`'s checks |
| `src/body.ts` | Reads a body with a byte count, so a chunked one can't dodge a limit |
| `src/bundle.ts` | Fetches a zip by hash and checks it |
| `src/gate.ts` | `BoxGate`: the rate limits, one Durable Object per Box and per address |
| `src/judgement.ts`, `src/judge.ts` | `Judgement`, the Durable Object per pot, and `Judge`, its logic over a plain store |
| `src/verdict.ts`, `src/audit.ts` | The checks on a verdict, and the sealed audit record |
| `src/signer.ts`, `src/upstream.ts`, `src/pot.ts` | The verifier key, the relayer and store, and `StorePot`'s reads |
| `src/container.ts` | `AgentContainer`, the outbound handler and the runner |
| `src/proxy.ts`, `src/tee.ts`, `src/zg-chain.ts` | The model proxy, the TEE check and 0G's serving contract |
| `src/audit-store.ts`, `src/zg-storage.ts` | The `AuditStore` interface, and 0G Storage behind it |
| `src/texts.ts` | Long text in Durable Object storage, in chunks under its 2 MB limit |
| `src/limits.ts`, `src/failure.ts`, `src/safe.ts`, `src/json.ts`, `src/abortable.ts` | The limits, why a run failed, redaction, JSON helpers and a deadline for work with no signal |
| `test/` | Every refusal, failure and crash on fakes, through `test/world.ts`. `relayer.test.ts` puts what a `Judge` really sends through the relayer's real routes |
| `test/fake-zg/` | A fake 0G for tests and for the end-to-end harness |
| `container/` | The agent's container: its own package and tests |

## Rules

- **Secrets stay in the Worker.** The container gets none, in its env or anywhere else.
- **Nothing the Worker logs or answers holds a key or a URL.** `src/safe.ts` scrubs every error, and a run's reason is
  always our own text, never the model's or the container's.
- **Tests never call real 0G.** The account holds 1 USD.

## The fake 0G

`pnpm --filter @egb/verifier fake-zg [port]` serves the Router, a provider's signature endpoint, 0G's chain and 0G
Storage on one port, and prints the Worker vars that point at it. `@egb/verifier/test/fake-zg` is the same thing as a
`fetch`. `POST /__fake` sets how it behaves, `GET /__fake` says what it has seen, and `GET /__fake/segments` hands back
what reached 0G Storage:

```sh
curl -d '{"payouts":["10000000","0"]}' http://127.0.0.1:8790/__fake     # the split the agent submits
curl -d '{"chat":"bad-signature"}' http://127.0.0.1:8790/__fake         # a turn that fails the TEE check
curl -d '{"shellCommand":"env"}' http://127.0.0.1:8790/__fake           # run this in the agent's shell; GET shows its output
```

## Run

```sh
pnpm --filter @egb/verifier test
cp apps/verifier/.dev.vars.example apps/verifier/.dev.vars && pnpm --filter @egb/verifier dev
```

`wrangler dev` builds the container and needs Docker. A local Wrangler older than the config's compatibility date needs
`--compatibility-date`. The relayer and the store must be deployed first, for the service bindings.

Deploy, then set the secrets (each straight into Wrangler, never through the terminal):

```sh
cd apps/verifier && wrangler deploy
wrangler secret put VERIFIER_PRIVATE_KEY
wrangler secret put ZG_API_KEY
wrangler secret put ZG_STORAGE_KEY
printf %s "$SEPOLIA_RPC_URL" | wrangler secret put SEPOLIA_RPC_URL
```

The verifier key must hold `VERIFIER_ROLE` on `StorePot`. Check its address with `GET /health`.
