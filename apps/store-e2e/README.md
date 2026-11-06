# apps/store-e2e

`@egb/store-e2e`: the store's end-to-end run. `pnpm store:e2e` publishes a game, plays staked matches on a real Box and
checks what the chain did, on one laptop. Anvil stands in for Sepolia, and 0G, `GameBoxNames`, the Box's hardware key and
the badges are fakes. The rest is real. The plan is [`plan/game-store.md`](../../plan/game-store.md).

It deploys nothing, holds no real key and calls no real chain or 0G. A run's keys are made up as it starts. It leaves no
process or container behind, even when a signal interrupts it. `kill -9` can't be caught, so the next run clears up after
that. Its temporary folder goes when it ends, or with the next run. `pnpm test` doesn't run it: it needs the tools below
and takes about five minutes.

## What runs

| Piece | How |
|---|---|
| The chain | `anvil` as Sepolia: its chain id, Osaka's P-256 precompile and a block a second |
| The contracts | `StorePot`, Store USDC and a `FakeUSDC`, from forge's build, wired as `DeployStorePot` wires them. The real `GameBoxNames` needs ENS, so a fork, and `StubNames` stands in: `StorePot` still goes through `BoxCheck`, its licence checks and the P-256 precompile |
| The relayer, the store and the verifier | Their real Workers on `wrangler dev --local`: workerd, Durable Objects, alarms and R2 |
| The agent | The real container in Docker, started and killed by the verifier as in production. Its one way out is `zg.internal`, through the real outbound handler |
| 0G | The fake (`apps/verifier/test/fake-zg`): the Router, the signature endpoint, the serving contract and Storage. It scripts the agent's turns, so the agent's verdict is what a scenario says |
| The Box | `apps/box/src/server/main.ts`, its real chain port and `processSigner`, on the fake receiver's stations and a software P-256 key |
| The kiosk | The built screen in a headless Chromium, with the Pi's flags. Tap Rush's real page runs in its sandboxed frame |
| The team | The real `store:publish` script |

`src/world.ts` starts all of it. A `link` is a second screen on the Box, sending what the kiosk's buttons send.

Each Worker runs from its real `wrangler.jsonc`, with its name, URLs and compatibility date changed and its service
bindings dropped, so the verifier uses `RELAYER_URL` and `STORE_URL`. Everything reads the run's own copy of
`deployments/sepolia.json`: the Workers through Wrangler's `alias`, the Box and the script through `src/deployments-hook.ts`.
The real file is never touched.

The agent's image is the real Dockerfile with a label added. `wrangler dev` deletes every other `cloudflare-dev` tag on an
image ID it builds, so without the label a `pnpm --filter @egb/verifier dev` beside a run would delete the run's image.

The ports are 28545 to 28554 (`src/ports.ts`). A run refuses to start if anything holds one.

## The scenarios

`test/store.e2e.ts`, in order, sharing one world. Each believes the chain: its balances, its events and its pots.

1. Tap Rush is published and listed, and reaches the rack.
2. Two badges stake and play, and the agent's split is paid. The audit record read back from Storage hashes to the pot's
   record, and each turn's proof is rechecked by hand.
3. A changed zip is refused: at the store, at the Box, which seals the game, and at the verifier.
4. An unlisted hash can't be staked, through the Box or straight on `StorePot`.
5. The agent's container is killed mid-run, and again on the retry, and each stake goes back to its address.
6. The agent's shell finds no secret and no way out, Docker holds no secret for its container, and `cannot_judge`
   refunds.
7. A forged verdict, one that doesn't add up and one from a wrong key are refused, by the relayer and by `StorePot`.
8. The agent's own split doesn't add up, and it refunds.
9. A turn fails the TEE check, and it refunds.
10. 0G Storage is down: the pot is paid, and the record lands once it is back.
11. With the verifier stopped, the refund is refused until anvil has moved on an hour, and then the Box's sweep does it,
    and a stranger can too.

## Moving time

A Worker's `Date.now` can't be moved, so the chain starts six hours behind the wall clock, and a jump never passes it.
Every deadline signed from the wall clock is good on chain, before and after. So the relayer's own early check of a refund
passes at once, and `StorePot` is what refuses it until the delay has run. The relayer's tests cover its check. The Box
reads its own clock against `rounds.json`, so scenario 11 stops it, ages the file and starts it again, as a Box coming back
after an hour away.

## What this doesn't prove

- Real 0G, and so whether a real provider's replies pass the TEE check. The fake is built from what mainnet did.
- Real Sepolia, a real `GameBoxNames` and the real deploy script. With no `BoxResults` on anvil, the Box's check of its
  rounds at start can't run, and says so in its log.
- Real Cloudflare. `wrangler dev` isn't the platform, and its container network isn't either. Its sidecar takes every TCP
  connection and then drops it, so a bare connect from the agent's shell succeeds here. Scenario 6 needs an answer back to
  call a way out open.
- A killed Worker, unless asked. Scenario 5 kills the container. A run's Durable Object wakes 9 minutes after the Worker
  dies, too long for every run, so `EGB_E2E_SLOW=1` adds the scenario that kills the Worker mid-run, which takes 10 minutes
  more.
- The badges, the HYP2003 key and the Pi. Taps come from the fake receiver, and the Box signs with a software key.
- More than two seats: the Box seats two for now.

## Run

It needs Foundry, Wrangler 4.111 or newer on the `PATH`, Docker running, a Chromium (`EGB_CHROMIUM` names one, see
`apps/box/src/server/games/chromium.ts`) and `contracts/lib` (`pnpm contracts:install`).

```sh
pnpm store:e2e
```

It builds the kiosk's screen, then runs. `-t` narrows it, but the first scenario must stay, as it sets up the rest:

```sh
pnpm --filter @egb/store-e2e e2e -t 'publishes Tap Rush|TEE check'
```

## What goes here

| Path | Holds |
|---|---|
| `src/world.ts` | Starts and stops the whole run |
| `src/anvil.ts`, `src/contracts.ts`, `src/foundry.ts` | The chain, the contracts and the run's deployments file |
| `src/wrangler.ts` | A Worker on `wrangler dev`, from its real config |
| `src/agents.ts` | The verifier's containers, through Docker |
| `src/zg.ts` | The fake 0G, in its own process |
| `src/tamper.ts` | A man in the middle in front of the store, as the store itself can't serve a changed zip |
| `src/box.ts`, `src/link.ts`, `src/match.ts` | The Box and its kiosk, a second screen on its link, and a match as two players play one |
| `src/p256-signer.ts`, `src/deployments-hook.ts` | What the Box starts with: a signer daemon on a software key, and the swap of the deployments file |
| `src/publish.ts` | The real `store:publish`, and Tap Rush under another id |
| `src/outsider.ts` | Someone who signs what they like, and sends it to the relayer, the verifier or `StorePot` |
| `src/ledger.ts` | What the chain says |
| `src/keys.ts`, `src/ports.ts`, `src/processes.ts`, `src/paths.ts` | A run's keys, its ports, its child processes and the repo's root |
| `test/store.e2e.ts` | The scenarios |
| `test/interrupted.e2e.ts`, `test/run-to-interrupt.ts` | That a signal leaves nothing behind, on a small run in its own process |
