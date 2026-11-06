# apps/demo-box

`@egb/demo-box`: a Game Box with no hardware, as a Cloudflare Worker. It does what the Pi does, with a software P-256
key in place of the HYP2003 token: it signs heartbeats and match results, and sends them through the
[relayer](../relayer/README.md). Live at **https://gamebox-demo-box.mathew.workers.dev**.

It runs `mumbai-01.gamebox.eth` and every pop-up Box (`popup-<label>.gamebox.eth`), all on one `BoxAccount`
(`DemoBoxAccount` in `deployments/sepolia.json`).

## Routes

| Route | Takes | Does |
|---|---|---|
| `GET /box` | | The Box's label, its account, its public key (`qx`, `qy`), its last heartbeat (`lastSeen`) and that heartbeat's relayer request ids |
| `POST /result` | `{ box, game, winner, loser, draw }` | Picks the next round, signs a `Result`, sends it through `POST /box/result`, and returns `{ id, round }` (the relayer's request id) |

On the site, the "who won" button is labelled for what it is: the demo Box, with a software key, reports the result.
At the event, the Box signs only after a real match. `POST /result` takes 10 per IP per hour.

## Heartbeat

A Durable Object alarm every 5 minutes signs a `BoxAccount.execute` of `PermissionedResolver.setText(lastSeen, <unix
seconds>)` on `mumbai-01.gamebox.eth` and on every live pop-up it runs, and of `game` wherever it differs from the
game the Box is running (the game of its last result, or `DEFAULT_GAME`). Each write goes through
`POST /box/execute`. Every request, and an hourly cron, restarts the alarm if it has stopped.

## Signing

The Box signs the raw 32-byte EIP-712 digest (`Execute`, `Result` from `@egb/shared/names`) with ECDSA P-256, no
prehash, and a low `s`: the contracts pass the digest itself to the EIP-7951 precompile, as the HYP2003 signs it with
`CKM_ECDSA`. Web Crypto can't make that signature, because its ECDSA always hashes the input with SHA-256 first, so
the signer uses `@noble/curves`. A test signs the contracts' digest vectors and gets their signatures byte for byte.

Rounds never repeat: reports run one at a time, the last round is kept in the Durable Object, and a round the chain
has already settled is skipped.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: the routes, CORS, and the cron that keeps the heartbeat running |
| `src/box.ts` | The heartbeat and the result reports (`Box`), and the `DemoBox` Durable Object around them |
| `src/signer.ts` | The software P-256 key |
| `src/chain.ts` | The Sepolia reads: Boxes, their `game`, settled rounds, recent pop-ups |
| `test/` | The heartbeat's digest and calls, round numbers, the rate limit, the signer against the vectors |

## Secrets and config

- `DEMO_BOX_P256_KEY`: a `0x`-prefixed 32-byte hex scalar, from `.env`. Never printed or committed.
- `SEPOLIA_RPC_URL`: for reads. It carries the node's key.
- `RELAYER_URL` and the `RELAYER` service binding: in production the Box calls the relayer through the binding,
  because a Worker can't fetch another `workers.dev` Worker on its own account.

```sh
cd apps/demo-box && wrangler deploy
printf %s "$DEMO_BOX_P256_KEY" | wrangler secret put DEMO_BOX_P256_KEY
printf %s "$SEPOLIA_RPC_URL" | wrangler secret put SEPOLIA_RPC_URL
curl https://gamebox-demo-box.mathew.workers.dev/box   # starts the heartbeat
```

For `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` and run the relayer's `wrangler dev` first.
