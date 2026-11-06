# The game store and the AI verifier

The plan for games that live online instead of on the Box. A team-published zip holds a game's page and the rules an
AI judge follows. The Box downloads the game each time it runs, up to four players stake and play, and an agent on 0G's
private inference reads the match's log and says who gets paid how much. If it can't, everyone gets their stake back.
Nothing here is built yet.

## 1. Goal

- **A mini game store:** an online index of every game bundle. There are no updates: a Box downloads a game each time
  it runs.
- **A game bundle:** a zip holding `index.html`, the game, and `manifest.json`, which describes it and carries the AI
  verifier's instructions.
- **A game verifier:** a Docker container, started on demand, that runs an agent over the match's logs and the
  manifest's instructions. It ends with who gets paid how much. On any failure, the funds go back to the addresses
  they came from.

Not in this plan: an in-Box store page, a store page on the public site, Forge-built games in the store, titles or
stats for store games, and any game fee.

## 2. Decisions

Each of these was asked and answered on 6 November.

| Question | Decision |
|---|---|
| What is judged | The Box's own tap log and the game's own events, labelled by source. |
| What a verdict pays | Any split of the pot between the match's players, adding up to exactly the pot. |
| Who has the final say | A verifier key. The Box can't change a verdict. |
| Where the container runs | Cloudflare Containers. |
| Who publishes | The team only. |
| Where the store lives | A Worker, with the zips in R2. |
| What "agent" means | A full agent with a shell, inside the container. |
| Which 0G | Testnet first, then mainnet by configuration, in Private mode. |
| Where the keys live | In the Worker. The container holds no secrets. |
| When it fails | One retry on a fresh container, then an instant refund. |
| Bundle versions | Immutable and pinned by hash. A new version is a new listing. |
| On the Box | Cartridges in the rack, beside team and built games. |
| Players | 2 to 4, everywhere. |
| Names and titles | Money only: no titles, stats or championships. |
| The audit record | On 0G Storage, with its hash on chain. |
| If the upload fails | Pay anyway, and keep retrying the upload. |
| The game's powers | Taps in, station text and buzz out. |
| The stake token | A separate test token for store games. |
| Agent code | Our own small loop. |

## 3. What this does and doesn't prove

Say this plainly on the site and in the demo.

- **0G proves the model.** In Private mode each turn runs in an attested enclave, and the Worker refuses any reply
  that isn't `tee_verified`. Say "each turn passed an attested enclave".
- **0G doesn't prove the prompt.** Its signature covers the reply, and its docs don't say it covers the request. No
  contract can check that a verdict came from the real log.
- **The Worker and the container aren't enclaves.** Whoever runs them could feed the agent a false log or sign a false
  verdict. The verifier key is trusted, and the contract limits the damage: it pays only the match's players, and
  only the exact pot.
- **The Box is trusted for taps.** It records them and signs the log, so a dishonest Box could forge one.
- **A store game isn't Verified.** That tier means the chain checks the result. Store games get a new tier, `judged`,
  shown on Stake before anyone stakes.

## 4. How it fits together

| Piece | Where | What it does |
|---|---|---|
| Bundle format | `packages/sdk` | Reads and checks a bundle, the manifest's types, and the frame's messages. |
| Store | `apps/store` (new Worker, R2) | Serves the index and the zips, and takes the team's uploads. |
| Verifier | `apps/verifier` (new Worker, with its container) | Takes a log, runs the agent, checks and signs the verdict, and holds every key. |
| `StorePot` | `contracts/src/game` | Holds stakes for 2 to 4 players, and pays a signed verdict or refund. |
| Store USDC | `deployments/sepolia.json` | A second deployment of `FakeUSDC`, with `StorePot` as its spender: the first one's spender is set for good to `DuelPot`. |
| Relayer | `apps/relayer` | New routes that send the pot's open, verdict and refund, and top up Store USDC. |
| The Box | `apps/box` | Lists, downloads and plays store games, records the log, and seats up to 4. |

## 5. One match, end to end

1. **Pick.** The rack shows store games from the index. If the index can't be reached, they don't appear, and team
   games play as usual.
2. **Join.** Two to four badges tap in, as many as the manifest allows.
3. **Download.** The Box fetches the zip into a temporary folder and checks its hash and shape. If that fails, the
   game is sealed and nothing is staked.
4. **Stake.** The Box signs a `Stake` naming the bundle's hash, the players and the amount. `StorePot` pulls Store USDC
   from each player.
5. **Play.** The game runs in the sandboxed frame. The Box records every tap and every event the game posts.
6. **End.** The game says it's over, or the manifest's time limit runs out. The Box signs the log and sends it to the
   verifier. The screen shows `JUDGING`.
7. **Judge.** The Worker checks the Box's signature and that the pot is open, and takes the instructions from the
   store by hash, never from the Box. It starts a container, and the agent works until it submits a verdict.
8. **Pay.** The Worker checks the verdict, builds the audit record, puts its hash in the signed verdict and sends it
   through the relayer. `StorePot` pays each player their share. The Box shows the split.
9. **Keep.** The Worker uploads the record to 0G Storage, and retries until it lands. The Box deletes the bundle.

**On failure:** one retry on a fresh container. If that fails too, the Worker signs a refund and each stake goes back
to the address it came from. If the verifier never answers at all, anyone can call the refund after a delay, and the
Box's sweep does so.

A failure is any of: a timeout, 0G unreachable, a reply that isn't `tee_verified`, an agent that says it can't judge,
or a verdict that fails the Worker's checks.

## 6. The bundle

A zip of `index.html`, `manifest.json` and any assets the page uses by relative path.

```json
{
  "format": 1,
  "id": "tap-rush",
  "title": "Tap Rush",
  "blurb": "Most taps in ten seconds takes the pot.",
  "players": { "min": 2, "max": 4 },
  "minutes": 1,
  "stakes": [5, 10, 25],
  "taps": "identify",
  "verifier": {
    "instructions": "Count each player's accepted taps from the Box's log. Most taps wins the whole pot. On a tie, split it evenly between the tied players."
  }
}
```

- **Checks on upload and on download:** the same reader, which refuses unsafe paths, oversized files and zip tricks. It
  starts from the `.game` prototype's reader, which was tested against hostile zips.
- **The hash is the game's identity.** It is the sha256 of the zip. The store never lets a listing change.
- **A bundle's code is untrusted.** It runs only in the kiosk's sandboxed frame, under the Box's own CSP header with no
  network, and never in Node.

### The game's powers

A small script the Box adds to the frame gives the game one object:

- **In:** the players and each `tap` (seat, time and roll, when the game asks for rolls).
- **Out:** `event(name, data)` for the log, `station(seat, text)` and `buzz(seat)`, cut to what a station shows and
  rate limited, and `end()`.

A game has no say over money. Its `end()` only closes the match.

## 7. The store

- `GET /index.json`: every listing: id, title, blurb, players, stakes, icon, hash and size.
- `GET /bundles/<hash>.zip`: a zip, cached forever.
- `POST /bundles`: an upload with the team's token. It runs the reader, stores the zip and adds the listing.
- `pnpm store:publish <folder>`: zips a folder, uploads it and calls `StorePot`'s `list(hash)`.

An unlisted hash can't be staked: `StorePot` checks that the team listed it, so a Box can't stake on a game the team
never read.

## 8. The verifier

**The Worker** is the only part with secrets: the verifier key, the 0G API key and the 0G Storage wallet.

**The container** has no secrets and no internet. `enableInternet = false`, and its one way out is a Cloudflare outbound
handler back to the Worker. It starts on demand, one per match, and stops at the end.

**The agent** is our own small loop on the OpenAI format, with two tools: `shell` and `submit_verdict`. It gets the
instructions and the log as files. It must end with `submit_verdict`, either as a split or as `cannot_judge`. Limits on
turns and time end a run that wanders.

**Every model call** goes through the Worker's proxy, which sets `X-0G-Provider-Trust-Mode: private` and
`verify_tee: true`, and fails the run on anything else. It records each turn, with its chat ID.

**Text from a game can steer the agent.** The log's game events are labelled as claims, and the prompt says to treat them
as data. That helps but doesn't guarantee anything, so the design assumes a tricked agent. The most it can do is
propose a bad split between the match's players, or fail the run. The team reads each game before listing it.

**The audit record** holds the log, the instructions, every turn with its chat ID, and the verdict. Its hash goes on
chain with the verdict.

## 9. The contract

`StorePot` takes up to four players, and is separate from `DuelPot` and `BoxResults`.

| Call | Signed by | What it does |
|---|---|---|
| `list(hash)` | Admin | Lets a bundle be staked. |
| `open(stake)` | The Box's P-256 key | Pulls `amount` from each player into a pot, keyed by Box and round. |
| `settle(verdict)` | The verifier key | Pays `payouts[i]` to `players[i]`. Refuses unless the payouts add up to the pot. |
| `void(refund)` | The verifier key | Sends each stake back at once. |
| `refund(box, round)` | Nobody | The same, for anyone, after the delay. |

A verdict names players only by position, so it has no way to pay anyone else. It also carries the audit record's hash.

## 10. Four players

The Box assumes two players throughout: `Seat` is `0 | 1`, ports use pairs, `EGB_STATIONS` must be exactly two, and
Join, Stake and Result draw two sides. This pass widens all of it to four.

- Team games stay two-player. Their rules use `other(seat)`, and a game's manifest sets its own limits.
- The firmware already takes four stations (`MAX_STATIONS`).
- Refunds and results pay a list of players, not a pair.

## 11. Steps

Each step ends with tests, and step 1 can stop the plan.

1. **Prove 0G.** On testnet: is there a private model, do tool calls work, and does `verify_tee` come back? Does the
   0G Storage SDK run in a Worker? If not, a second container with no agent does the upload.
2. **The bundle.** The format, the reader and a sample game, Tap Rush.
3. **The store.** The Worker, R2, `store:publish` and a deploy.
4. **The contract.** `StorePot`, its forge tests, Store USDC, the deploy and the relayer's routes.
5. **The verifier.** The Worker, the container, the agent and the failure paths, against a fake 0G and then testnet.
6. **The Box, two seats.** The library, the frame's powers, the log and the chain. A full staked match on the Pi.
7. **Four seats.** The core, the settings, the stations and every screen.
8. **Mainnet 0G.** Switch by configuration and play one match.

## 12. Needed from the team

- A 0G testnet key from pc.testnet.0g.ai, and a mainnet key from pc.0g.ai before step 8.
- A funded 0G wallet for Storage: the testnet faucet first, then real 0G.
- A Cloudflare plan with Containers on the account that runs the relayer. Not checked yet.
- A new verifier key, as a Worker secret.
- `forge`: Foundry isn't on the main development Mac yet, so contract tests need it installed.

## 13. Still to confirm

These came up while writing the plan. Each has a default the build will use unless the team says otherwise.

- **Team games:** they stay two-player. "2 to 4, everywhere" means the Box and store games.
- **The tier's name:** `judged`.
- **Who pays for 0G:** the team, from one balance. Players pay nothing extra, and a Box can't run up the bill beyond
  one run per open pot.
- **The one-chain rule:** `CLAUDE.md` says not to add other chains. 0G Storage needs transactions on 0G's chain, so
  the rule gets one exception: storage payments only, and no contracts there.
- **The refund delay:** one hour, as `DuelPot`.
- **Bet on X and B17:** unchanged by this plan.

## 14. Done when

- [ ] A team member publishes a game, and it appears in the rack on the Pi.
- [ ] A changed zip is refused, and an unlisted hash can't be staked.
- [ ] Four real badges on four stations stake and play a store game on the Pi.
- [ ] The agent's verdict pays a split on Sepolia, and the Box shows it.
- [ ] Killing the verifier mid-run retries once, then refunds each stake to its address.
- [ ] A forged verdict, one that doesn't add up, and one from a wrong key are all refused.
- [ ] With the verifier down, the refund works after the delay.
- [ ] Every model turn is `tee_verified`, on mainnet 0G.
- [ ] The audit record is on 0G Storage, and its hash matches the chain.
- [ ] The container has no secrets and can't reach the internet, proved by a test run from its shell.
- [ ] `pnpm typecheck`, the tests and `pnpm contracts:test` pass.

## Sources

- [0G Private Computer](https://0g.ai/pc/page.md): trust modes and endpoints.
- [0G Verifiable Execution](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution): `verify_tee` and what is signed.
- [0G Router overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview): testnet.
- [0G Storage SDK](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk): uploads.
- [Cloudflare Containers outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/): `enableInternet` and outbound handlers.
