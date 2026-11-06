# Handoff 3: titles and championships on the Box, with USDC stakes

Paste everything below the line into a fresh Claude Code session in `~/Workspace/ethereum-game-box`. Every earlier
session is stopped. Handoff 2's operator site, passkeys, agent and admin hand-over are **parked**: leave them on their
branches, unmerged and untouched.

---

You are building the Game Box's ENS demo for the "Best Use of ENSv2" judges. It is narrow on purpose:

> Two people tap their badges on the real Box, top up USDC in the lobby, stake it on a Stock Duel and play. The Box
> signs the result with its hardware P-256 key, and one transaction on Sepolia pays the pot, moves the **title** and
> scores the **championship**, all visible as ENS names.

Titles and championships are the two features to show working, and they use ENS in two different ways (see "Title
vs championship"). The operator site, passkeys, the agent `bot.gamebox.eth`, pop-up Boxes and the admin hand-over stay
out of this work and out of the demo. Don't delete their code.

## Read first

- `CLAUDE.md`. Its rules all apply: keys only in `.env` and Worker secrets, addresses only in
  `deployments/sepolia.json`, Sepolia for every contract, the team trailers on every commit.
- `plan/ens/README.md`: the names design (accounts, roles, records, signed messages, Sepolia gas facts).
- `plan/ens/1-contracts.md`: the ENSv2 facts and rules (the parent lock, the UserRegistry admin-bits trap, EAC).
- `apps/box/src/games/stock-duel/BLUEPRINT.md`, and `apps/box/src/core/` (`core.ts`, `ledger.ts`, `chain.ts`,
  `types.ts`).

## Where things stand (checked 2026-11-06)

**Git.** The branches have diverged, so step 0 joins them.

| Branch | State |
|---|---|
| `origin/main` | v1 names (PR #12), the v1 relayer and demo Box (PR #14), GBX (PRs #11, #13), the Box app. It is 13 commits ahead of `names-contracts`. Local `main` is 12 behind it. |
| `origin/names-contracts` | **v2, live on Sepolia:** `P256Account` and `P256AccountFactory`, the parent lock, `setBoxKey`, pop-ups, the wildcard default, and `gamebox.eth` pointed at it. It also has `@egb/shared/web` and `@egb/ui`. Not merged. |
| `origin/names-relayer` | The v2 relayer and demo Box: `/account/execute`, `/account/deploy`, ERC-1271 claims and the agent. Rebased onto an older `names-contracts`, which it is 7 commits behind. Not merged. |
| `origin/names-site` | `apps/web`, the names site, live at `gamebox-names.pages.dev`. It has the Champions page, the inspector, the Try grid and the Story rail. It is 7 behind `names-contracts`. Not merged. |
| `origin/names-operator` | Parked. |
| PR #15 `uniswap-4-staking` (open, a teammate's) | `BoxStaking`: GBX staked behind a Box, with USDC fees. It reads `GameBoxNames` and `external.USDC` (Circle's Sepolia USDC) from `deployments/sepolia.json`, and is deployed against **v1** `GameBoxNames`. **Don't touch it.** |

The main checkout also has an uncommitted kiosk exit button: `apps/box/src/server/kiosk.ts`,
`apps/box/src/screen/kiosk/`, and edits in `api.ts`, `box.ts`, `main.ts` and `frame.ts`. It is finished and its tests
pass. Ask George before committing it, and never discard it. Pulling `origin/main` doesn't conflict with it.

**Live services.**
- **The relayer** is `gamebox-relayer.mathew.workers.dev`, running the v2 code.
  - Its wallet is the deployer, `0xB2b6…C30E`, with **4.94 ETH**.
  - A request with no `Origin` header (a server) is allowed; CORS limits browsers only.
- **The demo Box** is `gamebox-demo-box.mathew.workers.dev`. It beats `mumbai-01` through the v2 `DemoBoxAccount`
  `0xB1eF…EA38`. Its software key's `qx`/`qy` are in `GET /box`.

**Size limit.** `GameBoxNames` (v2) is **22,379 bytes**, which leaves **2,197 bytes** under the 24,576-byte limit
(`forge build --sizes`). Anything new goes in new contracts, and `GameBoxNames` gains only small hooks.

**Stock Duel.**
- It plays and passes its tests in the simulator: `pnpm -C apps/box test` gives 556 passed.
- George says it doesn't work on the Box, and the cause is unknown. The user journal on the Pi is empty.
- Its stakes are a simulated "EGB" ledger: `core/ledger.ts`, `core/chain.ts`, and fake txs marked SIMULATED. Nothing
  reaches the chain.
- `core.ts` `conclude()` (around line 653) is where a match ends.
- The prices are a frozen deck in `built/deck.ts`.

**Badges** (HaLo).
- Key 2 signs only `sign_random` and refuses raw digests. Key 1 never signs (`taps/chip-ops.ts`).
- **So a badge can't sign a claim, an approval or a permit.** The Box vouches for a badge that tapped it, with the
  Box's own P-256 key.
- A player's address is the badge's key-2 identity, the one the roster uses.

**The Pi** (`ssh pi`).
- The services are `egb-server` and `egb-kiosk`, both running.
- The server reads `~/.config/egb/env`, which has **no chain settings**.
- **The HYP2003 token is plugged in and works.** `pkcs11-tool -L` shows "GameBox HYP2003".
- A working signer for it is on the Pi at `/home/pi/gamebox/current/deploy/p256-signer/`:
  - `hyp2003_signer.py`, with `--serve`, a one-shot digest mode and `--pubkey`;
  - the patched-OpenSC and libccid scripts;
  - a README.

  It isn't in this repo.
- The token's PIN is in `~/.config/gamebox/hyp2003-pins.env`. It never leaves the Pi.
- **`~/.config/gamebox/env` also holds an old `RELAYER_PRIVATE_KEY` on disk.** Don't read, use or copy it. George
  decides whether it is deleted.
- The display is a Goodix capacitive touchscreen, so the screen takes touch.

## Title vs championship

| | **Title**: `champion.stockduel.gamebox.eth` | **Championship**: `mumbai-cup.stockduel.gamebox.eth` |
|---|---|---|
| What it is | King of the hill: the last winner holds it | A time-boxed competition (30 minutes at the booth) with points across many matches and a USDC prize |
| Holders | One name, many holders over time | One name per event, and one holder forever |
| ENS mechanism | **Re-registration.** Each new winner gets the title by unregister + register (`crown` → `_moveTitle`), so the old token is gone. Non-transferable (no `CAN_TRANSFER_ADMIN`). It expires after the game's `titleTerm` unless defended | **Live records, then frozen.** While it runs, the name's own resolver has live `standings` (top 5, JSON), `leader`, `ends` and `prize` records, and its `addr` follows the leader. At close, the name is registered to the winner for good (max expiry, token roles 0) with the final records, and the championship contract gives up every role it holds on that resolver, so **the records can never change again** |
| What the judge sees | The holder changes on a win, the streak rises, the old token is gone, and a transfer attempt reverts `TransferDisallowed` | The standings move after each match. At close, the prize is paid, and the Try grid shows every write to the name reverting, for every account, ours included |
| Built | Yes | No: new |

Be exact on the site about what "frozen" means. The **records** are frozen, and the winner holds the name with no
expiry. The championship contract keeps registrar roles on the game's registry, because it needs them to open the
next championship. It has no function that touches a closed one.

## George's decisions

- **Fake USDC, not GBX.** Players stake fake USDC (6 decimals) on Sepolia. The simulated "EGB" goes. GBX and
  `external.USDC` stay as they are, for the teammate's staking work.
- **A lobby.** Players top up demo USDC themselves, with no ETH and no wallet.
- **P-256 carries over.** The Box signs with its HYP2003 key through its `P256Account`, and the relayer pays the gas.
- **The deployer keeps admin for now.** No passkeys and no hand-over. Never revoke anything on `gamebox.eth` itself.
- **Stock Duel gets a modern look** with the same mechanism (work E).

## The work

**Step 0: one base branch, before anything else.**
1. Cut `ens-demo` from `origin/names-contracts`.
2. Merge `origin/main`, then `origin/names-relayer`, then `origin/names-site`.
3. On a conflict:
   - in names code (`contracts/src/names`, `contracts/src/box`, `contracts/script/names`, `packages/shared/src/names`,
     `apps/relayer`, `apps/demo-box`, `apps/web`), take the newer names branch;
   - everywhere else (GBX, the Box app, Foundry setup), take `main`.
4. Keep every test green: `forge test`, `pnpm typecheck`, `pnpm test`.
5. Push, and open a PR into `main` titled "Join the names branches". Don't merge it.

Every track below branches from `ens-demo`.

Run tracks A to E as parallel agents, each in its own worktree and touching only its own files. Use Opus at medium or
high, or Sonnet at high, never xhigh. A's first commit (interfaces, ABIs, digests, shared module) unblocks B, C and D.
E starts at once. End with one independent review across all PRs (Opus, high).

### A. Contracts v3 (branch `ens-demo-contracts`)

`BoxResults` changes and `GameBoxNames` gains hooks, so redeploy the names with the existing scripts
(`contracts/script/names/`). Keep every v2 behaviour and test, and keep `getBox` and the `Box` struct's ABI as they
are, so `BoxStaking` can be redeployed against v3 unchanged.

1. **`FakeUSDC`** (`contracts/src/token/FakeUSDC.sol`):
   - an ERC-20 with 6 decimals, named "USD Coin (Game Box test)", symbol `USDC`;
   - `mint(to, amount)` for a `MINTER` (the deployer, which is the relayer);
   - one **game spender**, set once by admin to the `DuelPot`, which may move a player's balance with no allowance.
     The NatSpec says why: badges can't sign approvals or permits, and real USDC would need a permit.
2. **`DuelPot`** (`contracts/src/game/DuelPot.sol`):
   - `open(Stake, r, s)`:
     - the message is `Stake(string box,string game,uint256 round,address a,address b,uint256 amount,uint256 deadline)`
       on domain "Game Box Stakes" v1, signed by the Box's P-256 key (from `GameBoxNames.boxKey`);
     - check the deadline, that the Box is live and `Active`, that `a != b`, and that (box, round) has no pot yet;
     - pull `amount` from each player.
   - `settle(box, round, winner, draw)` is called only by `BoxResults`. It pays the winner `2 × amount`, or refunds both
     on a draw.
   - `refund(box, round)`: anyone may call it one hour after `open` if the pot is unsettled.
   - Events: `PotOpened`, `PotSettled` and `PotRefunded`.
   - The **round number is the shared key**: a match's `Stake` and its `Result` carry the same (box, round).
3. **`Championships`** (`contracts/src/names/Championships.sol`):
   - **`open(game, label, ends, prize)`, admin only, one open championship per game:**
     - registers `<label>.<game>.gamebox.eth` in the game's registry, owned by the contract and expiring at
       `ends + 1 day`;
     - gives the name its own `PermissionedResolver` from the VerifiableFactory, with no `UPGRADE` role for anyone;
     - writes `ends`, `prize` and `standings` (`[]`);
     - takes `prize` USDC from the opener.
   - **`score(game, winner, loser, draw)`, only from `BoxResults`:**
     - win 3, draw 1, loss 0;
     - rewrites `standings` (top 5) and `leader`, and sets `addr` to the leader.
   - **`close(game)`, anyone, after `ends`:**
     - the winner is whoever has the most points, then the most wins, then reached that score first;
     - pays the prize;
     - unregisters, then re-registers the name to the winner with max expiry and token roles 0;
     - writes the final `standings`, `winner` and `addr`;
     - then gives up every role it holds on that resolver.
     - With no players, the prize goes back to the opener, and the name is unregistered.
   - **Registry rights.** `GameBoxNames` holds `REGISTRAR`, `RENEW` and `UNREGISTER` with their admin roles on each
     title registry, which is the game's registry. Add one small hook: a one-time `setChampionships(address)`, admin
     only, that makes `addGame` (and a catch-up call for games added before) grant `Championships` those three roles.
     Then check the parent lock and the admin-bits rules in `1-contracts.md` still hold.
4. **Box-vouched player names.** Badges can't sign `ClaimName`. To stay within the size limit:
   - add `claimPlayerFor(label, badge)` to `GameBoxNames`, behind a new `SEATER_ROLE`. It has the same label rule, the
     same one-name-per-badge rule, and the same records and roles as `claimPlayer`. Share the internal code.
   - add a new **`BoxSeats`** contract that holds `SEATER_ROLE`.
     - It takes `Seat(string label,address badge,string box,uint256 deadline)` on domain "Game Box Seats" v1, signed by
       a live, `Active` Box's P-256 key.
     - It calls `claimPlayerFor`.
   - `claimPlayer` stays as it is.
5. **`BoxResults`.** After the existing crown and stats calls:
   - call `DuelPot.settle` if (box, round) has a pot. It must succeed, or the result reverts.
   - call `Championships.score` inside `try`, with a gas cap, so a scoring failure never blocks a result.

   One Box signature then settles everything.
6. **Size.** Run `forge build --sizes`, and keep `GameBoxNames` under 24,576 bytes with a margin.
7. **Tests** (forge, osaka):
   - **The pot:** open, settle, draw, refund, replay, the wrong key, a suspended or expired Box, and `a == b`.
   - **FakeUSDC:** the spender and the minter.
   - **A full championship:** open, scoring, each tiebreak, close and the prize paid. After close, read `roles` on the
     resolver for every account: all are zero. A write by an `eth_call` from every account reverts, the contract and
     the deployer included.
   - **The title** still moves, and the old token is gone.
   - **`BoxSeats`:** a good claim, the wrong Box key, a suspended Box, a second name for the same badge.
   - **Digest vectors** for `Stake` and `Seat` in `packages/shared`.
8. **Deploy** on Sepolia (the gas facts are in `plan/ens/README.md`):
   - FakeUSDC, `DuelPot`, `Championships`, `BoxSeats` and the changed names contracts, every one verified on Etherscan;
   - re-point `gamebox.eth` (`PointGameBox.s.sol`) and add both games.
   - Register `mumbai-01` with **the Pi's HYP2003 key**:
     - get it with `ssh pi 'python3 /home/pi/gamebox/current/deploy/p256-signer/hyp2003_signer.py --pubkey'`;
     - its `P256Account` comes from the factory.
   - Register `demo-01` with the demo-box Worker's key (from its `GET /box`), for the site's "Report a match".
   - Open `mumbai-cup` on `stockduel`, with a 100 USDC prize minted to the deployer and a 30-minute window. Add
     `OpenChampionship.s.sol` so George can open the next one with a label and a length.
   - Record everything in `deployments/sepolia.json`: FakeUSDC under `contracts.FakeUSDC`, with `external.USDC` left
     alone.
9. **First commit**, pushed early: the interfaces, `packages/shared` (ABIs, typed messages, digests and label rules for
   `Stake`, `Seat` and the championship records) and the new `deployments` keys.

### B. Relayer and demo Box (branch `ens-demo-relayer`, from A's first commit)

- **New routes**, with the same rules as the existing ones: every check before any gas, an `eth_call` first, errors
  named from the ABIs, and tests for every refusal.
  - `POST /usdc/topup { player }`. The player is an address or an ENS name, resolved with stock viem. It mints 100
    USDC if the balance is under 25. One per address per 10 minutes, 300 a day in total.
  - `POST /duel/open { stake, r, s }`. It checks the Box key the way `/box/result` does.
  - `POST /duel/refund { box, round }`. It is only valid an hour after `open`, if the pot is still unsettled.
  - `POST /players/box-claim { seat, r, s }`.
  - `POST /cup/close { game }`. It is only valid after `ends`.
- **The demo-box Worker:**
  - it becomes `demo-01` and stops beating `mumbai-01`, which the Pi owns now;
  - its alarm also calls `/cup/close` once `ends` passes, so a championship closes even if nobody clicks.
- Point both Workers at the v3 addresses and redeploy them.

### C. The Box (branch `ens-demo-box`, from A's first commit)

1. **Find out why Stock Duel fails on the Box, first.**
   - On the Pi, play one match with two badges and write down what breaks.
   - Check the game's state before restarting anything.
   - The user journal is empty, so add a log file if you need one.
   - Fix it, and add a test that would have caught it.
   - Mute the website when testing, never the Pi's speaker.
2. **The signer in this repo:**
   - Copy the Pi's signer folder into `deploy/p256-signer/` and update its README to this repo's layout. Never copy a
     PIN or env file.
   - Have the Box server start it from `P256_SIGNER_CMD`.
   - Add `P256_SIGNER_CMD`, `RELAYER_URL` and `SEPOLIA_RPC_URL` to `deploy/pi/env.example` and to the Pi's
     `~/.config/egb/env`.
   - Keep a software key only for the simulator and tests.
3. **A chain port for stakes.** It replaces the simulated ledger and fake chain for stakes, behind the existing
   `ports`, so `core.ts` keeps its shape (everything as modules):
   - **balance:** a read of the player's USDC;
   - **lock:** a Box-signed `Stake` to `/duel/open`. Don't wait for it: the match starts at once, and the tx bar
     follows it;
   - **settle:** a Box-signed `Result` to `/box/result`, with the same round as the `Stake`;
   - **refund:** `/duel/refund`.
   - The Box keeps its round counter on disk, so rounds never repeat across restarts.

   Then:
   - Rename EGB to USDC everywhere (`grep -rn EGB apps/box/src`), tests included.
   - Stakes are 5, 10 or 25 USDC.
   - The tx bar shows real hashes from the relayer's `/tx/:id`, linked to Etherscan, and drops the SIMULATED tag.
4. **The lobby (a Box view, by touch and taps).**
   - A badge tapped at any station shows:
     - the badge's player name. A new badge gets a proposed label from a short word list, with a button for another,
       and claiming sends a Box-signed `Seat` to `/players/box-claim`;
     - its USDC balance, and a **Top up 100 USDC** button, which calls `/usdc/topup`;
     - the title's holder and streak, and the championship's standings and countdown, read through the Universal
       Resolver.
   - Pre-set the labels for `DEMO_BADGES` (nova, kite, juno; `screen/link/sim/badges.ts`).
   - A player whose balance is under the stake is sent to the lobby from the stake screen.
5. **The result screen** names the winner by ENS name. It shows lines such as:
   - "+20 USDC";
   - "now holds champion.stockduel.gamebox.eth";
   - "mumbai-cup: 2nd, 6 pts".

   Each line is read from chain after the result's receipt, never from local state.
6. **Tests:**
   - the port against a mocked relayer;
   - the `Stake`, `Seat` and `Result` digests against the shared vectors;
   - the lobby flow with sim badges;
   - a full simulated match that makes the right relayer calls in the right order.

### D. The names site (branch `ens-demo-site`, from A's first commit)

- Point the site at the v3 addresses.
- **Lobby page:**
  - pick or type a player name (it resolves through ENS);
  - see the balance;
  - Top up through `/usdc/topup`;
  - a list of every player with their USDC balance.
- **Championship page:**
  - for an open championship: live standings from the name's records, the leader by name, a countdown and the prize;
  - for a closed one: the frozen name, its winner, and the Try grid with every write reverting;
  - past championships, from events;
  - "frozen" worded exactly as in "Title vs championship".
- **Champions page:** keep it; it is the title.
- **Story**, five steps:
  1. The tree.
  2. Claim a name (a test badge in the browser).
  3. Top up in the lobby.
  4. **Title:** two wins reported through `demo-01` move it; the old token is gone and a transfer reverts.
  5. **Championship:** live standings, then a closed championship frozen for good.

  Pop-ups, the operator and the agent leave the story. Their pages may stay.
- Deploy to the same Pages project.

### E. Stock Duel's look (branch `ens-demo-stockduel-look`, from `ens-demo`)

"Modern" here means **clean, current game UI with no theme**:
- bold type, real depth and strong motion;
- not the painted study (walnut, brass, wax seals);
- not the console's Grid/Tron look (no neon lines, grid floor, circuit traces or HUD brackets).

Only the player colours (orange P1, cyan P2) and the motion limits carry over.

Keep the mechanism exactly as it is:
- cards;
- a Rolodex drum per player with index tabs, so players see what's next;
- the stat chosen last;
- the auto-play after one drum turn;
- cards upright on the wheel.

1. **Comps first.** Make two still comps of the match screen and the reveal, and show them to George. Build only the
   one he picks.
2. Re-skin in place: `games/stock-duel/screen.ts`, `dial.ts`, `reveal.ts`, `rolodex.ts`, `scene.ts`, `score.ts`,
   `stock-duel.css` and `built/screen.ts`. No rules change, and every test still passes.
3. Compare screenshots with the picked comp at the end, at the Pi's display size.

## Rules

- Merge nothing without George's yes. One PR per track into `main`, after step 0's PR.
- Never move ETH between wallets. If `/health` shows the deployer under 0.5 ETH, say so and wait.
- Never revoke anything on `gamebox.eth`.
- Keys stay in Worker secrets and the Pi's own config. Never write one to disk anywhere else, and never print one. The
  HYP2003 PIN never leaves the Pi.
- Don't touch PR #15 or `BoxStaking`.
- No hard-coded addresses and no dead code. Keep every folder's README current. Visual checks once, at the end.

## Done when

- **Step 0:** `ens-demo` is pushed and green, with its PR open.
- **A:** tests are green, and every contract is deployed and verified. `mumbai-01` holds the HYP2003 key, and
  `mumbai-cup` is open with its prize. A forge test proves that nobody can write a closed championship's records.
- **B:** the routes are deployed. The live smoke test tops up two players, opens a pot and reports a result, then
  checks:
  - the pot was paid;
  - the title moved;
  - the standings changed.
- **C:** on the real Box, two new badges:
  - claim names in the lobby;
  - top up;
  - stake 10 USDC;
  - play Stock Duel to the end.

  The winner's +20 USDC, the title and the championship points each show on the screen and on Etherscan.
- **D:** the five-step story runs twice in a row on the live site, at desktop and phone width.
- **E:** George picked a comp, and the built screen matches it on the Pi.
- One independent review across every PR, then a report to George:
  - each PR;
  - every live address;
  - the Etherscan links from the hardware run;
  - that PR #15's `BoxStaking` still points at v1 `GameBoxNames` and needs a redeploy against v3, which is its
    owner's call;
  - what is still parked.
