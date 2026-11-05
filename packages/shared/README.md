# packages/shared

`@egb/shared`: the code every app needs to agree on. If two apps would otherwise each write it, it lives here.

## What goes here

| Path | Holds |
|---|---|
| `src/messages.ts` | The Box's message formats (result, attestation, heartbeat) and their digests, matching the contracts byte for byte |
| `src/entry.ts` | The badge's EIP-712 game entry and its Permit2 witness |
| `src/abis/` | Contract ABIs, generated from `contracts/out` after each build |
| `src/deployments.ts` | Loads `deployments/sepolia.json`, so no app hard-codes an address |
| `src/chains.ts` | Sepolia and Robinhood Chain settings, with RPC URLs taken from the environment |

## Rules

Every digest here has a test that checks it against the contract's own computation. A mismatch here is a wasted
badge tap at the table.
