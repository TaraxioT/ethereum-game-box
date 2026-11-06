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

## `src/names/`

| Module | Holds |
|---|---|
| `keys.ts` | Every record key, grouped by who may write it (Box, player, game and title names, and `gamebox.eth`'s default record), the Box `status` values, the operator's commission bounds (`COMMISSION_MIN_BPS`, `COMMISSION_MAX_BPS`), and the ENSIP-26 agent keys (`agent-context`, `agent-endpoint[<protocol>]`) |
| `labels.ts` | The label rule (`labelProblem`: 3 to 32 of `a-z`, `0-9`, `-`, no hyphen at either end), the same one `GameBoxNames` checks, the pop-up, full and title names, and a name DNS-encoded for a resolver (`dnsName`) |
| `messages.ts` | The three EIP-712 messages (`ClaimName`, `Execute`, `Result`): the typed data a wallet signs and the digest the contract checks, for a single `execute` and for `executeBatch` (`encodeCalls`) |
| `webauthn.ts` | The two signature forms a `P256Account` takes: raw (`rawSignature`) and a passkey's assertion (`webAuthnChallenge`, `parseDerSignature`, `encodeWebAuthnSignature`), low `s` always; a passkey's public key from its SPKI (`p256PublicKeyFromSpki`); an assertion checked the way the account checks it (`checkAssertion`, `assertionSignature`); and `base64url` |
| `p256.ts` | P-256 without WebAuthn's help: the hash an authenticator signs (`assertionHash`), the keys a signature recovers to (`recoverP256Keys`), `verifyP256`, and a public key read from or written as `0x04` + x + y (`parseP256PublicKey`, `p256PublicKeyHex`) |
| `roles.ts` | ENSv2's registry and resolver role bits, the resources for a text key or coin type, a decoder from bitmap to role names, and `GameBoxNames`' own roles |
| `abis.ts` | The ABIs of the names contracts and of the ENSv2 slice they call. Generated: `pnpm names:abis` builds the contracts and rewrites it |
| `vectors.json` | Written by `contracts/test/names/Vectors.t.sol`; `vectors.test.ts` checks `messages.ts`, `webauthn.ts`, `primaryName.ts` and `roles.ts` against it |
| `primaryName.ts` | A badge's primary name: the ERC-191 message it signs for ENS's `DefaultReverseRegistrar`, so `getEnsName(badge)` returns its player name |
| `api.ts` | The relayer's and the demo Box's HTTP request and response types |
| `deployments.ts` | `ensAddress(name)`, `contractAddress(name)` and `namesProxies()` (with `gamebox.eth`'s own resolver) from `deployments/sepolia.json` |
| `vectors.ts` | Fixed inputs with the digests and signatures the contracts produced (`vectors.json`, written by the forge test `Vectors.t.sol`), including a batch and a passkey signature the account ran; every key in it is a throwaway test key |

`scripts/abis.ts` writes `abis.ts` (`pnpm names:abis`). `scripts/names/verify.ts` and `scripts/names/check.ts` are
`pnpm names:verify` and `pnpm names:check`, which verify and check the live deployment (see `contracts/README.md`).

### P-256 signatures (`Execute`, `Result`)

Every account with a role is a `P256Account`, bound to one P-256 key. Its `execute` and `executeBatch` take a
signature over the `Execute` digest in one of two forms (`webauthn.ts`):

- **Raw**, `r ‖ s` (64 bytes): ECDSA P-256 over the raw 32-byte digest with no prehash. The contracts pass the digest
  itself to the EIP-7951 precompile as `h`, never its SHA-256. That is what the HYP2003 does with `CKM_ECDSA`, and what
  `@noble/curves` does with `prehash: false`. `Result` is always signed this way, by the Box. A software key (the demo
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

## Rules

Every digest here has a test that checks it against the contract's own computation. A mismatch here is a wasted
badge tap at the table.
