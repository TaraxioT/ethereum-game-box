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
| `src/swap/` | The tap swap on the GBX/USDC pool, imported as `@egb/shared/swap` (below) |

## `src/names/`

| Module | Holds |
|---|---|
| `keys.ts` | Every record key, grouped by who may write it (Box, player, game and title names), the Box `status` values, and the ENSIP-26 agent keys (`agent-context`, `agent-endpoint[<protocol>]`) |
| `labels.ts` | The label rule (`labelProblem`: 3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the same one `GameBoxNames` checks, and the pop-up, full and title names |
| `messages.ts` | The three EIP-712 messages (`ClaimName`, `Execute`, `Result`): the typed data a wallet signs and the digest the contract checks |
| `roles.ts` | ENSv2's registry and resolver role bits, the resources for a text key or coin type, a decoder from bitmap to role names, and `GameBoxNames`' own roles |
| `abis.ts` | The ABIs of the names contracts and of the ENSv2 slice they call. Generated: `pnpm names:abis` builds the contracts and rewrites it |
| `vectors.json` | Written by `contracts/test/names/Vectors.t.sol`; `vectors.test.ts` checks `messages.ts`, `primaryName.ts` and `roles.ts` against it |
| `primaryName.ts` | A badge's primary name: the ERC-191 message it signs for ENS's `DefaultReverseRegistrar`, so `getEnsName(badge)` returns its player name |
| `api.ts` | The relayer's and the demo Box's HTTP request and response types |
| `deployments.ts` | `ensAddress(name)`, `contractAddress(name)` and `namesProxies()` from `deployments/sepolia.json` |
| `vectors.ts` | Fixed inputs with the digests and signatures the contracts produced (`vectors.json`, written by the forge test `Vectors.t.sol`); every key in it is a throwaway test key |

`scripts/abis.ts` writes `abis.ts` (`pnpm names:abis`). `scripts/names/verify.ts` and `scripts/names/check.ts` are
`pnpm names:verify` and `pnpm names:check`, which verify and check the live deployment (see `contracts/README.md`).

### P-256 signatures (`Execute`, `Result`)

The Box signs the raw 32-byte EIP-712 digest with ECDSA P-256 and no prehash: the contracts pass the digest itself to
the EIP-7951 precompile as `h`, never its SHA-256. That is what the HYP2003 does with `CKM_ECDSA`, and what
`@noble/curves` does with `prehash: false`. The signature must have a low `s` (at most n/2), or the contracts refuse
it. A software Box key (`DEMO_BOX_P256_KEY`) is a `0x`-prefixed 32-byte hex scalar. On chain the public key is
`qx`, `qy` (`BoxAccount.publicKey()`), and a Box name's `boxKey` record is `0x04` + x + y.

## `src/swap/`

| Module | Holds |
|---|---|
| `tapSwap.ts` | `GameBoxHook`'s EIP-712 `TapSwap` message (the typed data and the digest the Box signs with P-256, like `Execute`) and `tapSwapHookData`, the hook data a tap swap carries to the pool |
| `vectors.json` | Written by `contracts/test/hook/SwapVectors.t.sol`; `tapSwap.test.ts` checks `tapSwap.ts` against it |
| `vectors.ts` | `TAP_SWAP_VECTOR`, typed, signed with the names vector Box key |

## Rules

Every digest here has a test that checks it against the contract's own computation. A mismatch here is a wasted
badge tap at the table.
