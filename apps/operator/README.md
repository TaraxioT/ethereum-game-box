# apps/operator

`@egb/operator`: the Game Box operator site, live at **https://gamebox-operator.pages.dev**. An operator manages their
Box from a passkey here, never on the Box. The passkey is a P-256 key that controls a `P256Account` on Sepolia; that
account owns the Box's name under `gamebox.eth` and writes its four operator records. The relayer pays every gas fee,
so the operator needs no wallet and no ETH. An account holding `LICENSOR_ROLE` on `GameBoxNames` also sees the admin
view, which issues and manages Box licences.

A static site on Cloudflare Pages, with the same stack and Schematic look as `apps/web`: Vite and TypeScript, small
DOM builders and no UI framework, viem for every read over public Sepolia RPCs (no key in the bundle). Every digest,
ABI, key, label rule and address comes from `@egb/shared/names`.

```sh
pnpm --filter @egb/operator dev        # http://localhost:5174, with /_relayer passed through to the relayer
pnpm --filter @egb/operator test       # Vitest, then the Playwright passkey flow
pnpm --filter @egb/operator deploy     # builds and deploys to the gamebox-operator Pages project
```

The Playwright run needs Chromium once: `pnpm --filter @egb/operator exec playwright install chromium`.

## What goes here

| Path | Holds |
|---|---|
| `src/passkey.ts` | WebAuthn: make a passkey (ES256, user verification required, discoverable), sign in, and sign a digest. Keeps only the credential id and public key in localStorage |
| `src/p256.ts` | What WebAuthn leaves out: the hash an authenticator signs, a key recovered from a sign-in's signature, a signature check, and a Box key read from `0x04` + x + y |
| `src/account.ts` | A passkey's `P256Account`: `accountOf`, whether it exists, `LICENSOR_ROLE`, and the write path (sign, deploy if needed, execute) |
| `src/session.ts` | Who is signed in, and their account |
| `src/boxes.ts` | Box licences from `BoxRegistered` events and `getBox`, with records read from each Box's own resolver |
| `src/records.ts` | The operator form's rules, what changed, and its `setText` calls |
| `src/admin.ts` | The licence forms' rules and the `registerBox`, `renewBox`, `setBoxStatus` and `setBoxKey` calls |
| `src/relayer.ts`, `src/txs.ts`, `src/errors.ts` | The relayer over HTTP, each write's progress for the transaction strip, and reverts by name |
| `src/chain.ts`, `src/config.ts` | The viem client and the contracts from the deployments loader; RPCs, relayer URL, relying party |
| `src/views/`, `src/ui/` | Sign in, the account strip, the operator view, the admin view; the element builder, Sepolia tag and strip |
| `src/operator.css` | The look. Tokens and fonts come from `@egb/box` |
| `e2e/` | The Playwright passkey flow, with a CDP virtual authenticator, a mock chain and a mock relayer (`deployments.json` holds its test addresses) |

## How a write goes

1. The site builds the calls: one `setText` per changed operator record on the Box's resolver (one `executeBatch`),
   or one licence call on `GameBoxNames` (`execute`). Nonce: a random 64-bit number. Deadline: 15 minutes.
2. The passkey signs the EIP-712 digest (`executeBatchDigest` or `executeDigest`) as its WebAuthn challenge, with
   user verification. This happens first, inside the click, because browsers want a passkey prompt to follow a
   user gesture. The site checks the assertion (type, challenge, UV, the key's signature) before sending it.
3. If the account has no code yet, `POST /account/deploy` deploys it, and the site follows it to `done`.
4. `POST /account/execute` sends the signed request, and the strip follows it through `/tx/:id`.

After registering a Box or rotating its key, the admin view also deploys the Box key's account if it doesn't exist.

## Passkeys

- A passkey works only on the site it was made on. The relying party is the page's host, and on Pages previews
  (`<hash>.gamebox-operator.pages.dev`) it is `gamebox-operator.pages.dev`, so live passkeys work on previews too.
- A sign-in (`get`) never returns the public key. The site uses the key it kept for that credential; on a device
  that hasn't seen it, it recovers the two candidate keys from the signature and takes the one whose account exists,
  or asks for a second signature to tell them apart.
- Until `P256AccountFactory` is in `deployments/sepolia.json`, the account's address can't be shown; the public key
  still is (the copy button gives `0x04` + x + y). The site reads addresses at build time, so redeploy it after the
  deployments file changes.

## Rules

- Every digest, ABI, key, label rule and address comes from `@egb/shared/names`; nothing here writes its own.
- The relayer's CORS must allow `https://gamebox-operator.pages.dev` (and its previews); the dev server passes
  requests through instead.
