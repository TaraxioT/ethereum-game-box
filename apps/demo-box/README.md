# apps/demo-box

`@egb/demo-box`: a Game Box with no hardware, as a Cloudflare Worker, and the agent `bot.gamebox.eth`. The Box does
what the Pi does, with a software P-256 key in place of the HYP2003 token: it signs heartbeats and match results, and
sends them through the [relayer](../relayer/README.md). Live at **https://gamebox-demo-box.mathew.workers.dev**.

It runs `mumbai-01.gamebox.eth` through its `P256Account` (`DemoBoxAccount` in `deployments/sepolia.json`). Pop-up
Boxes (`popup-<label>.gamebox.eth`) are linked to `mumbai-01`'s record, so they serve its records, heartbeat
included, with no writes of their own.

## Routes

| Route | Takes | Does |
|---|---|---|
| `GET /box` | | The Box's label, its account, its public key (`qx`, `qy`), its last heartbeat (`lastSeen`) and that heartbeat's relayer request ids |
| `POST /result` | `{ box, game, winner, loser, draw }` | Picks the next round, signs a `Result`, sends it through `POST /box/result`, and returns `{ id, round }` (the relayer's request id) |
| `GET /agent` | | The agent: its label and name, its account (`P256AccountFactory.accountOf` of its key), its public key, the ENSIP-26 records it publishes, and its next setup step (`deploy`, `claim`, `records` or `done`) |
| `POST /agent/setup` | | Starts the agent's next setup step and returns `{ step, id }` (the relayer's request id); `{ step: "pending", id, tx }` while the last step's request is still pending; `{ step: "done" }` once all are done |
| `POST /mcp` | a JSON-RPC message | The agent's MCP endpoint (`agent-endpoint[mcp]`): Streamable HTTP, stateless, JSON replies. Its tools are `agent` (what `GET /agent` shows) and `box` (what `GET /box` shows) |

On the site, the "who won" button is labelled for what it is: the demo Box, with a software key, reports the result.
At the event, the Box signs only after a real match. `POST /result` takes 10 per IP per hour.

## Heartbeat

A Durable Object alarm every 5 minutes signs one `POST /account/execute` for `mumbai-01.gamebox.eth`:
`PermissionedResolver.setText(lastSeen, <unix seconds>)`, and, in the same `executeBatch` under the same signature,
`setText(game, ...)` if the record (read first through the resolver's ENSIP-10 `resolve`, which costs nothing) is not
the game the Box is running: the game of its last result, or `DEFAULT_GAME`. Every request, and an hourly cron,
restarts the alarm if it has stopped.

## The agent

`bot.gamebox.eth` is the practice opponent. Its account is a `P256Account` bound to the Worker secret
`AGENT_P256_KEY`; it holds no ETH, and the relayer pays its gas. It sets itself up in three steps, one signed request
each, through `POST /agent/setup`:

1. `deploy`: its account, through `POST /account/deploy`.
2. `claim`: `bot.gamebox.eth`, through `POST /names/claim`. Its key signs the `ClaimName` digest raw, and
   `GameBoxNames` checks it with the account's ERC-1271 `isValidSignature`.
3. `records`: its ENSIP-26 records through `POST /account/execute`, in one batch: `agent-context` (Markdown: who it
   is and what it plays) and `agent-endpoint[mcp]` (`<PUBLIC_URL>/mcp`). Only records that differ are written.

Call it until it answers `done`, a few seconds apart (each step waits for the last one's request to be done):

```sh
until curl -s -X POST https://gamebox-demo-box.mathew.workers.dev/agent/setup | tee /dev/stderr | grep -q '"done"'; do
  sleep 15
done
```

Once it holds its name, `PlayerStats` writes its `stats` like any player's.

## Signing

The Box and the agent sign the raw 32-byte EIP-712 digest (`Execute`, `Result`, `ClaimName` from `@egb/shared/names`)
with ECDSA P-256, no prehash, and a low `s`: the contracts pass the digest itself to the EIP-7951 precompile, as the
HYP2003 signs it with `CKM_ECDSA`. A `P256Account` takes the raw form as `r ‖ s` (64 bytes). Web Crypto can't make
that signature, because its ECDSA always hashes the input with SHA-256 first, so the signer uses `@noble/curves`. A
test signs the contracts' digest vectors and gets their signatures byte for byte.

Rounds never repeat: reports run one at a time, the last round is kept in the Durable Object, and a round the chain
has already settled is skipped.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: the routes, CORS, and the cron that keeps the heartbeat running |
| `src/object.ts` | The `DemoBox` Durable Object: the Box, the agent, and the heartbeat alarm |
| `src/box.ts` | The heartbeat and the result reports (`Box`) |
| `src/agent.ts` | The agent's setup and view (`Agent`), and its `agent-context` |
| `src/mcp.ts` | The agent's MCP endpoint |
| `src/execute.ts` | The `POST /account/execute` body: record writes, signed raw, one call or a batch |
| `src/relayer.ts` | The relayer's routes, through the service binding |
| `src/signer.ts` | A software P-256 key |
| `src/chain.ts` | The Sepolia reads: Boxes, text records, settled rounds, accounts and names |
| `test/` | The heartbeat's digest and calls, round numbers, the rate limit, the signer against the vectors, the agent's steps, the MCP endpoint |

## Secrets and config

- `DEMO_BOX_P256_KEY`: the Box's key, a `0x`-prefixed 32-byte hex scalar. It lives only as this Worker's secret.
- `AGENT_P256_KEY`: the agent's key, the same form. It was generated straight into the secret and was never printed.
- `SEPOLIA_RPC_URL`: for reads. It carries the node's key.
- `PUBLIC_URL`: this Worker's URL, for `agent-endpoint[mcp]`.
- `RELAYER_URL` and the `RELAYER` service binding: in production the Box calls the relayer through the binding,
  because a Worker can't fetch another `workers.dev` Worker on its own account.

```sh
cd apps/demo-box && wrangler deploy
printf %s "$SEPOLIA_RPC_URL" | wrangler secret put SEPOLIA_RPC_URL
curl https://gamebox-demo-box.mathew.workers.dev/box   # starts the heartbeat
```

A new agent key goes straight from the generator into the secret, and only its public key is printed:

```sh
node -e 'const{p256}=require("@noble/curves/nist.js");process.stdout.write("0x"+Buffer.from(p256.utils.randomSecretKey()).toString("hex"))' \
  | wrangler secret put AGENT_P256_KEY
```

For `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` and run the relayer's `wrangler dev` first.
