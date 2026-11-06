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
| `src/web/` | What the sites (`apps/web`, `apps/operator`) need in a browser, imported as `@egb/shared/web` (below) |
| `src/admin/` | What `gamebox.eth`'s admin does, imported as `@egb/shared/admin` (below) |
| `src/swap/` | The tap swap on the GBX/USDC pool, imported as `@egb/shared/swap` (below) |
| `src/store/` | The game store's messages and the verifier's API, imported as `@egb/shared/store` (below) |

## `src/admin/`

The calls only the admin key may make, for any app that holds it (the Box's Admin tab now, a site later). No DOM, no
Node.

| Module | Holds |
|---|---|
| `calls.ts` | Each call built and checked before anything is sent (`AdminInputError`): `addGameCall` (a title term of a minute to a year), `openCupCall` (a run of a minute to 90 days, never named `champion`), `closeCupCall`, and `openCupCalls`, which mints the prize's shortfall and approves `Championships` first. Calls that create storage carry `CREATES_STORAGE_GAS` |
| `reads.ts` | `boardReads(client).view()`: at one block, every game (from `GameAdded`, scanned once then incrementally) with its title and open championship, and the latest 10 championships with an open one's leader; `adminReads(client, admin).view()` adds the admin's ETH, USDC and roles |
| `lease.ts` | A Box's lease in `BoxLease`: `leaseReads(client).view(label, staker?)` (the lease, the name's standing and expiry, the rate and bounds, the staker's GBX and allowance, at one block), `leaseOpen` and `leaseLeft`, and the calls `stakeCalls` (approving first when short), `unstakeCall` and `lapseCall` |
| `send.ts` | `adminSender(wallet, client)`: one call at a time, each `eth_call`ed first (`AdminRefused` with the contract's error name), sent, and waited for; a nonce clash (the relayer shares the key) retried once |

## `src/names/`

| Module | Holds |
|---|---|
| `keys.ts` | Every record key, grouped by who may write it (Box, player, game, title and championship names, and `gamebox.eth`'s default record), the Box `status` values, the operator's commission bounds (`COMMISSION_MIN_BPS`, `COMMISSION_MAX_BPS`), a championship's `standings` JSON (`Standing`, `parseStandings`, `STANDINGS_SIZE`), and the ENSIP-26 agent keys (`agent-context`, `agent-endpoint[<protocol>]`) |
| `labels.ts` | The label rule (`labelProblem`: 3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the same one `GameBoxNames` checks, the pop-up, full, title (`TITLE_LABEL`) and championship names (`championshipName`, `championshipLabelProblem`), and a name DNS-encoded for a resolver (`dnsName`) |
| `messages.ts` | The five EIP-712 messages (`ClaimName`, `Execute`, `Result`, `Stake`, `Seat`): the typed data a wallet signs and the digest the contract checks, for a single `execute` and for `executeBatch` (`encodeCalls`). The Box signs `Result`, `Stake` (domain `Game Box Stakes`, for `DuelPot`) and `Seat` (domain `Game Box Seats`, for `BoxSeats`) with P-256 |
| `usdc.ts` | The demo's test USDC: `USDC_DECIMALS` (6), `usdc(10)` to base units and `formatUsdc` back |
| `webauthn.ts` | The two signature forms a `P256Account` takes: raw (`rawSignature`) and a passkey's assertion (`webAuthnChallenge`, `parseDerSignature`, `encodeWebAuthnSignature`), low `s` always; a passkey's public key from its SPKI (`p256PublicKeyFromSpki`); an assertion checked the way the account checks it (`checkAssertion`, `assertionSignature`); and `base64url` |
| `p256.ts` | P-256 without WebAuthn's help: the hash an authenticator signs (`assertionHash`), the keys a signature recovers to (`recoverP256Keys`), `verifyP256`, and a public key read from or written as `0x04` + x + y (`parseP256PublicKey`, `p256PublicKeyHex`) |
| `gas.ts` | `CREATES_STORAGE_GAS`, the limit for a call that creates a resolver or a registry, for every sender |
| `roles.ts` | ENSv2's registry and resolver role bits, the resources for a text key or coin type, a decoder from bitmap to role names, `GameBoxNames`' own roles (with `SEATER_ROLE`) and `FakeUSDC`'s (`USDC_ROLES`) |
| `abis.ts` | The ABIs of the names contracts and of the ENSv2 slice they call. Generated: `pnpm names:abis` builds the contracts and rewrites it |
| `vectors.json` | Written by `contracts/test/names/Vectors.t.sol`; `vectors.test.ts` checks `messages.ts`, `webauthn.ts`, `primaryName.ts` and `roles.ts` against it |
| `primaryName.ts` | A badge's primary name: the ERC-191 message it signs for ENS's `DefaultReverseRegistrar`, so `getEnsName(badge)` returns its player name |
| `api.ts` | The relayer's and the demo Box's HTTP request and response types, including the agent's `GET /agent` (`AgentView`, `AgentStep`) |
| `deployments.ts` | `ensAddress(name)`, `contractAddress(name)`, `namesProxies()` (with `gamebox.eth`'s own resolver) and `deployedAddresses()` (every contract address, for the relayer's allowlist) from `deployments/sepolia.json`. A zero-address placeholder counts as not deployed |
| `vectors.ts` | Fixed inputs with the digests and signatures the contracts produced (`vectors.json`, written by the forge test `Vectors.t.sol`), including a batch and a passkey signature the account ran; every key in it is a throwaway test key |

`scripts/abis.ts` writes `abis.ts` (`pnpm names:abis`). `scripts/names/verify.ts` and `scripts/names/check.ts` are
`pnpm names:verify` and `pnpm names:check`, which verify and check the live deployment (see `contracts/README.md`).

### P-256 signatures (`Execute`, `Result`, `Stake`, `Seat`)

Every account with a role is a `P256Account`, bound to one P-256 key. Its `execute` and `executeBatch` take a
signature over the `Execute` digest in one of two forms (`webauthn.ts`):

- **Raw**, `r ‖ s` (64 bytes): ECDSA P-256 over the raw 32-byte digest with no prehash. The contracts pass the digest
  itself to the EIP-7951 precompile as `h`, never its SHA-256. That is what the HYP2003 does with `CKM_ECDSA`, and what
  `@noble/curves` does with `prehash: false`. `Result`, `Stake` and `Seat` are always signed this way, by the Box, and
  sent as `(r, s)`. A software key (the demo
  Box's, the agent's) is a `0x`-prefixed 32-byte hex scalar.
- **WebAuthn**, from a passkey: call `navigator.credentials.get` with `webAuthnChallenge(digest)` as the challenge and
  `userVerification: 'required'`, read `r` and `s` with `parseDerSignature(response.signature)`, and encode with
  `encodeWebAuthnSignature`. The account checks `"type":"webauthn.get"`, the challenge, and the user-present and
  user-verified flags. Read a new passkey's key with `p256PublicKeyFromSpki(response.getPublicKey())`; its account's
  address is `P256AccountFactory.accountOf(qx, qy)`, before and after it is deployed.

Either way `s` must be low (at most n/2), or the contracts refuse it; every encoder here makes it low. An
`executeBatch` signs `Execute` with the account itself as `target`, `value` 0 and `dataHash` =
`keccak256(encodeCalls(calls))` (`executeBatchDigest`). A `ClaimName` for an account (the agent's) is signed raw over
the claim digest: the account's ERC-1271 `isValidSignature` takes the raw form only. On chain the public key is `qx`,
`qy` (`P256Account.publicKey()`), and a Box name's `boxKey` record is `0x04` + x + y.

## `src/web/`

Browser-side code both sites use. It holds no DOM code (that is `@egb/ui`) and no state of its own: each site makes
its own client, head watch and transaction log.

| Module | Holds |
|---|---|
| `chain.ts` | `sepoliaClient(urls)` over public RPCs with a fallback (`PUBLIC_SEPOLIA_RPCS`), `ETHERSCAN`, `LOG_CHUNK`, and `watchHead(client)`, the polled head block (`HeadWatch`: `head`, `onHead`, `stop`) |
| `errors.ts` | Reverts by name, from every names ABI and the ENSv2 slice: `decodeRevert`, `revertData`, `errorName` |
| `relayer.ts` | `relayerClient(base)` and `demoBoxClient(base)` over HTTP, typed with `names/api.ts`; `ApiRefusal`; the live `RELAYER_URL` and `DEMO_BOX_URL` |
| `txs.ts` | `txLog({ follow })`: the writes a transaction strip draws (`onTxs`, `relayed`, `direct`), with `Tx`, `TxFailed` and `fromView` |

## `src/swap/`

| Module | Holds |
|---|---|
| `tapSwap.ts` | `GameBoxHook`'s EIP-712 `TapSwap` message (the typed data and the digest the Box signs with P-256, like `Execute`) and `tapSwapHookData`, the hook data a tap swap carries to the pool |
| `vectors.json` | Written by `contracts/test/hook/SwapVectors.t.sol`; `tapSwap.test.ts` checks `tapSwap.ts` against it |
| `vectors.ts` | `TAP_SWAP_VECTOR`, typed, signed with the names vector Box key |

## `src/store/`

| Module | Holds |
|---|---|
| `api.ts` | The on-chain messages (`StoreStake`, `StoreVerdict`, `StoreVoid`), the verifier's HTTP API, what passes between its Worker and its container, and the audit record |
| `messages.ts` | `StorePot`'s three EIP-712 messages (domain `Game Box Store Pots`) and the verifier's `Judge` (domain `Game Box Verifier`, whose `verifyingContract` is the pot): `store*TypedData`, `judgeTypedData` and their digests. `jsonTextHash` is the keccak256 of exact JSON text, as a `Judge`'s `log` and an audit record's `record` both are. The Box signs `Stake` and `Judge` with P-256 over the raw digest; a verifier key signs `Verdict` and `Void` with ECDSA |
| `deployments.ts` | `storePotAddress()` and `storeUsdcAddress()`, each `undefined` until it is deployed |
| `vectors.json` | Written by `contracts/test/game/StoreVectors.t.sol`; `messages.test.ts` checks `messages.ts` against it |
| `vectors.ts` | The vectors, typed, signed with the names vector Box key and anvil's second well-known key |

`storePotAbi` is generated with the others into `src/names/abis.ts`, and exported here too.

## Rules

Every digest here has a test that checks it against the contract's own computation. A mismatch here is a wasted
badge tap at the table.
