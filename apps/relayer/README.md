# apps/relayer

`@egb/relayer`: a Cloudflare Worker that pays the gas for the Box. It sends only requests the Box key signed.

## What goes here

| Path | Holds |
|---|---|
| `src/index.ts` | The Worker: `POST /relay` and `GET /health` (wallet balance, pending count) |
| `src/verify.ts` | Checks the Box's P-256 signature and its key against the registry, before any gas is spent |
| `src/sender.ts` | A Durable Object per chain: one nonce queue, so two requests never race |
| `src/replay.ts` | Refuses a digest it has already sent |
| `wrangler.jsonc` | Worker config. Secrets (`RELAYER_PRIVATE_KEY`, the RPC URL) are set with `wrangler secret put`, never committed |

## Rules

- The relayer wallet holds gas only. It is never the deployer and never the Box.
- Errors never echo the RPC URL: it carries the API key.
- `wrangler dev` reads `.dev.vars` once at start; restart it after changing them.

## First milestone

A token-signed heartbeat from the Pi is relayed; a forged one is refused with no gas spent.
