# Ethereum Game Box

A game console you play by tapping a badge. Players hold HaLo NFC badges (a wallet in a chip); the Box is a
Raspberry Pi with a screen, tap stations and a HYP2003 P-256 hardware key. Matches are staked and settled on chain.
The project plan is [`plan/index.html`](plan/index.html).

## Layout

A pnpm monorepo. Each folder's README says what goes in it; read it before adding to that folder.

- `apps/box/`: the Box: core, Pi server, taps, game builder, screen and games (`@egb/box`).
- `apps/relayer/`: the Cloudflare Worker that sends the Box's signed requests (`@egb/relayer`).
- `apps/web/`: the public site (`@egb/web`).
- `packages/sdk/`: the contract between the Box and its games (`@egb/sdk`).
- `packages/shared/`: message digests, the badge entry, ABIs and the deployments loader (`@egb/shared`).
- `contracts/`: Foundry. Every contract, its forge tests and deploy scripts.
- `deployments/`: `sepolia.json`, every deployed address.
- `firmware/tap-station/`: the ESP32 tap stations and their receiver.
- `deploy/pi/`: Pi setup, the update script and systemd units.
- `plan/`: the project plan page.

Workspace packages extend `tsconfig.base.json` and define `typecheck`, `test` and `build` scripts, which the root
runs across all of them (`pnpm typecheck`, `pnpm test`, `pnpm build`). Contracts: `pnpm contracts:test`.

## Rules

- **Sepolia for every contract.** Robinhood Chain mainnet is read only, for stock prices. Don't add other chains.
- Addresses live in `deployments/sepolia.json`. Nothing hard-codes an address.
- Keys live only in `.env` and Worker secrets. Never commit, print or log one. Redact RPC URLs from errors (they
  carry the API key).
- Small typed modules with one job each. No dead code, and no copy-paste between packages: shared code moves to
  `packages/shared`.
- A feature is done when its contracts are deployed and tested, the Box uses it, `pnpm typecheck` and the tests pass,
  and it ran on the Pi with real badges.
- Commits are small and say what changed. Credit the team with these trailers:

  ```
  Co-Authored-By: beingentangled <6350192+beingentangled@users.noreply.github.com>
  Co-Authored-By: saithyasivadas <34595181+saithyasivadas@users.noreply.github.com>
  Co-Authored-By: Athuli7 <4718029+Athuli7@users.noreply.github.com>
  Co-Authored-By: lizgeorge1 <155816293+lizgeorge1@users.noreply.github.com>
  ```

## The plan page

Publish after each change to `plan/index.html`:

```sh
plans publish plan/index.html --name ethereum-game-box --date 2026-11-05
```

It goes to https://plans.georgekm.com/ethereum-game-box-2026-11-05/, replacing the previous version.
