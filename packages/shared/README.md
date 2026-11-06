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
| `src/names/` | The ENS names under `gamebox.eth`, imported as `@egb/shared/names` (below) |

## `src/names/`

| Module | Holds |
|---|---|
| `keys.ts` | Every record key, grouped by who may write it (Box, player, game and title names), the Box `status` values, and the ENSIP-26 agent keys (`agent-context`, `agent-endpoint[<protocol>]`) |
| `labels.ts` | The label rule (`labelProblem`: 3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the same one `GameBoxNames` checks, and the pop-up, full and title names |
| `messages.ts` | The three EIP-712 messages (`ClaimName`, `Execute`, `Result`): the typed data a wallet signs and the digest the contract checks |
| `roles.ts` | ENSv2's registry and resolver role bits, the resources for a text key or coin type, a decoder from bitmap to role names, and `GameBoxNames`' own roles |
| `abis.ts` | The ABIs of the names contracts and of the ENSv2 slice they call. Generated: `pnpm names:abis` builds the contracts and rewrites it |
| `deployments.ts` | `ensAddress(name)` and `contractAddress(name)` from `deployments/sepolia.json` |

## Rules

Every digest here has a test that checks it against the contract's own computation. A mismatch here is a wasted
badge tap at the table.
