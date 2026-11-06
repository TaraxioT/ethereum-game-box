<p align="center">
  <img src="oled.svg" alt="A tap station's screen reading: tap to play" width="100%">
</p>

<h1 align="center">Ethereum Game Box</h1>

<p align="center">
  A game console you play by tapping a badge.<br>
  Every match is staked and settled on Ethereum, and nobody at the table needs ETH, a wallet app or a single pop-up.
</p>

<p align="center">
  <sub>ETHGlobal Mumbai 2026 &nbsp;·&nbsp; <a href="https://plans.georgekm.com/ethereum-game-box-2026-11-05/">Plan on the web</a> &nbsp;·&nbsp; <a href="index.html">Plan source</a></sub>
</p>

<p align="center">
  <a href="#what-it-is">What it is</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a> &nbsp;·&nbsp;
  <a href="#games-and-the-token">Games and the token</a> &nbsp;·&nbsp;
  <a href="#partner-tracks">Partner tracks</a> &nbsp;·&nbsp;
  <a href="#where-we-are">Where we are</a> &nbsp;·&nbsp;
  <a href="#how-we-get-there">How we get there</a>
</p>

<br>

> [!NOTE]
> **In one sentence:** the badge is the wallet, the Box is the referee, and Ethereum is the bank.

> [!NOTE]
> The sections up to Partner tracks describe the design. [Where we are](#where-we-are) says what runs today.

## What it is

### The problem

On-chain games ask too much before the fun starts: install a wallet, buy gas, approve a token, sign a prompt you
can't read. That works for one person at a desk. It doesn't work for four friends around a table, a booth at an
event, or a bar on a Friday night.

### The idea

The Game Box is a small console: a Raspberry Pi with a screen and a speaker, tap stations for the players, and a
hardware key inside that gives the Box its own identity on chain. Players carry NFC badges, each one a wallet whose
key never leaves the chip. **Tap to join, tap to stake, tap to play.**

### What a player does

1. **Walks up and taps.** The Box reads the badge's wallet and sends it test tokens. No ETH needed, ever: the relayer
   pays the gas.
2. **Gets a name.** One more tap claims `name.gamebox.eth`, which follows the player from Box to Box.
3. **Picks a game and stakes.** A single tap signs the entry and moves the stake into the game contract. The screen
   shows who is in and what is at stake.
4. **Plays.** Taps are the controls: first to tap, pick a card, lock in a choice.
5. **Gets paid.** The Box signs the result, the chain checks it and pays the winner, all in about ten seconds. Wins
   move titles like `champion.stockduel.gamebox.eth`.

### Who it's for

|  |  |
|---|---|
| **Players** | Real stakes and real ownership, with nothing to install and nothing to learn beyond "tap here". |
| **Operators** | Anyone can run a Box at a café, an event or at home, stake to it, and earn a share of every game played on it. |
| **Game makers** | One game interface: `start`, `step`, `outcome`, plus a `game.json`. Write the rules, and the Box handles badges, stakes and payouts. Or describe a game to the Box, and the game builder writes it. |

### What we're building this weekend

- One working Box on the table, with two tap stations and a handful of badges.
- Real games with real stakes on Sepolia, settled in seconds.
- A token launched on Uniswap, whose fees feed back into the games.
- Names for every Box and every player on ENS, and a public site that reads them.

## How it works

### On the table

| Piece | What it is |
|---|---|
| **The Box** | A Raspberry Pi 5 with a touchscreen and a Bluetooth speaker. It runs the games, the screen and the sound, and talks to the chain. |
| **The Box key** | A HYP2003 USB token. Its P-256 key is made on the chip and never leaves it. Every result, entry and heartbeat the Box sends is signed by it. |
| **Tap stations** | One per player: an ESP32-S3 with a PN532 NFC reader, a small OLED, an LED and a buzz motor. It talks over ESP-NOW to a receiver on the Pi's USB. |
| **Badges** | Arx HaLo NFC chips. Each holds a wallet key (key 1) that can never be copied out, and an identity key (key 2) that signs random rolls. The Box hashes a typed message (EIP-712) and key 1 signs the digest, a step we still have to test on a badge. |

### In the cloud and on chain

| Piece | What it is |
|---|---|
| **Relayer** | A Cloudflare Worker that pays the gas. It sends what a Box key or a badge signed, plus a few rate-limited requests such as test-token drips. It sends one transaction at a time, and refuses anything else before spending a wei. |
| **Contracts on Sepolia** | The names (which also hold the Box registry), the games, the token and its Uniswap pool, and staking. All on one chain, so everything can call everything. |
| **ENS** | `gamebox.eth` names every Box and every player, and carries live titles like the current champion. |
| **Public site** | Reads ENS and the contracts to show Boxes, players and champions, and sends writes through the relayer. No backend of its own. |

### Why the Box key matters

Ethereum can now check P-256 signatures natively: the `P256VERIFY` precompile, about 7,000 gas. So the Box doesn't
need a seed phrase or a hot wallet. A cheap hardware token, the same kind used for digital signatures in India,
becomes an on-chain identity. Contracts know which Box sent a result, and the licensor can rotate or suspend that key
at any time.

### One match, end to end

```mermaid
sequenceDiagram
    autonumber
    participant B as Badge
    participant T as Tap station
    participant X as Box
    participant R as Relayer
    participant S as Sepolia
    B->>T: signs the entry (Permit2 + game entry)
    T->>X: carries the tap
    X->>R: wraps both entries, signs with the Box key
    R->>R: checks the Box key against the registry
    R->>S: sends it, pays the gas
    S->>S: game pulls both stakes
    Note over B,X: Play: taps drive the game, both badges add signed randomness
    X->>R: signs the result
    R->>S: settle
    S-->>B: pays the winner in the token they staked
```

- **Entry.** The badge signs one Permit2 message whose payload is the game entry. The game contract is the only
  spender, and it rebuilds the message from the entry, so nobody in between can change a thing.
- **Open.** The Box wraps both entries in a request signed by its key. The relayer checks that signature against the
  registry, then sends it. The game contract pulls both stakes.
- **Play.** Taps drive the game. Where a game needs chance, both badges add their own signed randomness, so neither
  the Box nor a player picks the outcome.
- **Settle.** The Box signs the result. The contract checks the signature, the round and the expiry, then pays the
  winner in the token they staked.
- **Safety net.** If the Box never settles, both players take their stakes back after a timeout.

> [!WARNING]
> **Not settled:** PR #18 stakes a different way. The Box signs one `Stake` for both players and `DuelPot` pulls test
> USDC, with no badge signature and no fee. Where we are lists what decides it.

### What you have to trust

Every game declares one of two tiers, and the Box shows it before anyone stakes.

| Tier | Meaning |
|---|---|
| **Verified** | The chain can check the result itself. Pots can be large, and a challenge window lets anyone prove a Box cheated and take its stake. |
| **Refereed** | Only the Box saw what happened, like who tapped first. Pots are capped, and the Box's stake backs its word. |

## Games and the token

### The games

| Game | How it plays | Tier |
|---|---|---|
| **Quick Draw** | The screen says "draw". First tap wins. The simplest game, and the first one we build end to end. | Refereed |
| **Stock Duel** | Best of three. Each player plays a stock from a spinning Rolodex; once both cards are down, the two badges' randomness picks the stat (price, average price, 24-hour move or liquidity), read live from Robinhood Chain's stock pools. Cards flip together; a timer plays for a slow player. Today the numbers come from a frozen deck. | Refereed, with a public replay proof |
| **Bet on X** | Two players state a claim the chain can check ("gas is under 2 gwei at block N"), offer odds, and both tap. A checker contract settles it from chain state. Not built: sealed in the Box's rack. | Verified |
| **B17** | A heist on a vault. A bot keeps sending transactions; players buy ranges of its future nonce. Wider ranges cost more (width squared), and the narrowest range holding the live nonce takes the vault. Not built: sealed in the Box's rack. | Verified |

Stock Duel is the main game. Its replay proof will be the Robinhood block number and the exact pool reads for each
round, so anyone can recheck the result. It claims no proof while it plays from the frozen deck.

### The game builder

Anyone can make a new game on the Box, which wasn't in the first plan. A Designer asks one question at a time, by
keys, typing or voice. A Forge agent (Claude Sonnet) then writes the game from a Quick Draw or Stock Duel template,
confined to one folder, and checks and installs it. Its rules run in a locked-down child process with no network or
disk writes, and its screen in a sandboxed frame that only draws. Built games are always Refereed. The first, Rooftop
Dash, took 57 seconds on the Pi.

### The token

Games are staked in the Game Box token, GBX: one billion minted once, burnable, with no way to mint more. It launches
through Uniswap's Continuous Clearing Auction, which sets a fair
opening price and then seeds a Uniswap v4 pool. That pool carries our own hook, with three fee levels:

| Fee | When |
|--:|---|
| **1%** | Any normal swap. |
| **0.25%** | A swap made with a badge tap at a Box, up to a daily cap tied to that Box's stake. Playing in person earns the discount. |
| **0%** | Swaps through a router we approve for the game contract, so the buyback costs nothing. |

The hook also keeps a time-weighted price, which v4 doesn't provide. The buyback and the operator auction use it, so
neither can be pushed around by one big trade.

### Where the fees go

Every settled game pays a small fee, split in half:

- **Half buys the token back and burns it,** through the pool at zero fee. More games, less supply.
- **Half goes to the Box,** shared between its operator and the people who staked to it.

### Boxes, operators and stakers

- **Operators** win the right to run a Box through an operator auction, priced from the pool's time-weighted price.
  The tokens they bid become the Box's stake.
- **Stakers** back a Box they trust and earn from its games. The operator sets a commission between 10% and 90%. A
  raise only takes effect after a delay; a cut applies at once.
- **Cheating costs stake.** Unstaking waits out a delay, and until it ends, a proven cheat can take the Box's stake.
- **The lobby** lets a player swap USDC for the token with one tap, at the tap fee, and stake to the Box in the same
  tap.

## Partner tracks

<details open>
<summary><b>Uniswap</b>: launch, hook, buyback, operator auction</summary>

- **Launch:** the token launches through the Continuous Clearing Auction into a v4 pool.
- **Hook:** our v4 hook sets the fee per swap: 1%, 0.25% with a badge tap and the Box's signature, 0% for the game
  contract. It also keeps the time-weighted price.
- **Buyback and burn:** every settled game swaps half its fee into the token and burns it.
- **Operator auction:** a second auction sells the right to run a Box, priced from the hook's time-weighted price.
- **Judges see:** a tap-discount swap at the Box, then a game settling and the burn landing on chain. We keep
  `FEEDBACK.md` as we go, as the track asks.

</details>

<details open>
<summary><b>ENS</b>: Box names, player names, live titles</summary>

- **Box names** like `mumbai-01.gamebox.eth` carry the Box's key and status, and expire with its licence.
- **Player names** are claimed with a tap and never expire. The badge owns its records, and the game may only write
  its stats.
- **Live titles:** `champion.stockduel.gamebox.eth` moves to each new winner, only after a signed win. A title lapses
  after its term: 7 days for Stock Duel, 15 minutes for Quick Draw.
- **The site** reads names through ENS and lists them from contract events: no database behind it.
- **Pop-ups:** anyone can open a 10-minute Box name, which stands in for a licence until the operator auction.
- **Championships:** a cup like `mumbai-cup.stockduel.gamebox.eth` keeps live standings. Its winner keeps the name and
  the prize, and the records freeze. In review on PR #18.
- **Judges see:** they claim a name with their own tap, win a round, and watch the title move to them on the site.

</details>

<details open>
<summary><b>0G</b>: voice bets, a practice opponent, an audit log</summary>

- **Voice:** players speak a bet, and 0G turns it into terms the chain can check.
- **Practice opponent:** an AI player to learn against.
- **Decision log:** every AI decision is stored on 0G Storage with its request ID, so it can be audited.
- **Safe stop:** if 0G doesn't answer, the Box refuses. It never guesses.
- We add this once our 0G credits arrive; the rest of the plan doesn't depend on it.

</details>

### Chains

| Chain | What for |
|---|---|
| **Sepolia** | Every contract: Boxes, games, the token and its pool, staking, and the ENS names. |
| **Robinhood Chain** | Read only: the stock pools whose live prices drive Stock Duel. |

## Where we are

What runs today, as of 6 November, what we have to decide, and what comes next.

> [!IMPORTANT]
> **The gap:** the contracts, relayer and site are live on Sepolia, and the Box plays real games on real hardware, but
> the two aren't joined. The Box has no chain client and no signer for its key, so every stake and payout on it is
> simulated. Milestones 1 to 5 all wait on joining them.

### What runs today

| Piece | State | Detail |
|---|---|---|
| **The Box** | Simulated money | The server, screen, both games and refunds run on the Pi, with real stations and real badge rolls. Stakes, payouts and blocks are simulated. Games have run on injected taps and resting badges, not yet on hand taps. |
| **Game builder** | On `main` | It built a game on the Pi and played it, on the simulated ledger. |
| **Box key** | Not built | The HYP2003 isn't set up on the Pi, and the Box has no signer. Only the demo Box signs, with a software key. |
| **Chain client** | Not built | The Box has no client, no relayer calls and no port for them. The chain is simulated inside its core. |
| **Relayer and demo Box** | Live | The relayer is funded, and the demo Box beats through it every 5 minutes. The live Workers appear to run the PR #17 line, not `main`. |
| **Names** | Live | `gamebox.eth`, Box and player names, titles and signed results. ENS points at the PR #18 deployment, so `main`'s `deployments/sepolia.json` is out of date. |
| **Pots, seats and cups** | In review | `DuelPot`, `BoxSeats`, `Championships` and test USDC are deployed (PRs #16, #18, #17). Nothing on the Box calls them. |
| **Public site** | Live, off `main` | https://gamebox-names.pages.dev comes from `ens-demo-site`, which has no PR. |
| **Operator site** | Live, off `main` | https://gamebox-operator.pages.dev comes from `names-operator`, which has no PR and holds the older addresses. Operators edit records with a passkey; an admin issues licences. |
| **GBX** | Live | Deployed, with no pool and nothing burned. |
| **Staking and the hook** | In review | `BoxStaking` and `GameBoxHook` are deployed (PRs #15, #19). PR #19 leaves the pool uninitialized, the hook has no daily cap yet, and no game sends them fees. |
| **Stock Duel data** | Not built | It plays from a frozen deck: no live Robinhood reads and no replay proof. |
| **Token flows** | Not built | The launch auction, the game fee, buyback and burn, and the lobby swap. |
| **Trust** | Not built | Pot caps, the challenge window and proof of cheating. Nobody can slash a Box until a dispute contract exists. |
| **The network** | Not built | The operator auction, Bet on X, B17 and 0G. |

No chain feature has met our done rule yet: none has run on the Pi with real badges.

### Decisions to make

- **Can a badge sign a stake?** The design has key 1 sign a Permit2 digest. PR #18 assumes a badge signs only
  `sign_random`, but that is key 2's limit: the Box's notes say key 1 signs anything. Nobody has tried it on our
  badges, and one test on the Pi settles it.
- **What do players stake?** The design says GBX, with a fee on every game. PR #18 stakes test USDC with no fee, while
  staking and the hook use Circle's USDC. Suggested: keep test USDC for the demo, because it's live and needs no badge
  signature, and move the pool and staking to the same token, or no fee can reach the burn. A Box key alone can move
  any badge's test USDC, which is fine for test money and not for real money.
- **Which deployment is the real one?** `main`, PR #16 and PR #18 hold three sets of addresses, and ENS points at PR
  #18's. Suggested: make it canonical. PRs #15 and #19 read the older names contract, so redeploy staking and the hook
  on it before the pool is initialized, because the pool's id changes with the hook.

### What comes next

1. **Test key 1.** Add a test-page button that asks key 1 to sign a digest, and try it on a real badge. That settles
   the first decision.
2. **Land the live line.** Merge PRs #16, #18, #17 and #20 in that order once PR #16's hold lifts, open PRs for
   `ens-demo-site` and `names-operator`, and bring `main`'s addresses up to date.
3. **Put the Box on chain.** Set up the HYP2003 on the Pi, add the signer, a chain port and a relayer client, and send
   a real heartbeat. That closes milestone 1.
4. **Play for stakes.** Run a staked match through the pot with hand taps. That closes milestone 2 and moves a title
   for milestone 5.
5. **Make Stock Duel live.** Read Robinhood Chain's pools and record the replay proof for milestone 3.
6. **Finish the token.** Redeploy and merge staking and the hook, initialize the pool, add the game fee, buyback and
   lobby, and fill in `FEEDBACK.md`, which has no entries yet.
7. **Then the network.** Milestone 6 is the first thing to cut.

## How we get there

### How we work

- **One feature at a time, finished.** Contracts, the Box, the screen and the tests, then a run on the real Box with
  real badges. Only then does the next one start.
- **The demo always works.** Each milestone leaves something we could show. If time runs out, we cut from the end of
  the list, never from the middle.
- **A test page on the Box** gets a button for every new chain call, tap and signature, so each piece is checked on the
  hardware before it goes into a game.
- **Split where it's safe.** Once the first game works, the token, the names and staking touch separate contracts and
  can be built side by side.

### Milestones

| # | Milestone | What it adds | Done when | Now |
|:-:|---|---|---|---|
| 1 | **The Box on chain** | The monorepo and deploy pipeline, Box licences with a P-256 key, and the relayer. | The Box's token signs a heartbeat on the Pi, the relayer sends it, and a forged one is refused. | Part done. The relayer is live and a software-key demo Box beats through it. The HYP2003 isn't set up on the Pi. |
| 2 | **First game** | Badges join and get tokens, one-tap staked entry, the game escrow with refunds, and Quick Draw. | Two badges play Quick Draw for stakes without holding any ETH, and the winner is paid. | On a simulated ledger only. `DuelPot` is deployed, but the Box doesn't call it. |
| 3 | **Stock Duel** | Live Robinhood Chain prices, two-badge randomness, best of three, and the replay proof. | A staked match runs on the Box with live prices, and its proof checks out. | Rules done, on a simulated ledger. No live prices and no replay proof. |
| 4 | **The token** | The auction launch, the fee hook, buyback and burn, lobby swaps, and staking to Boxes. | Each fee level shows on a real swap, and a settled game burns tokens and pays its stakers. | GBX is live. Staking and the hook are deployed, in review. No pool, auction, buyback or lobby. |
| 5 | **Names** | Box and player names, the champion title, and the public site. | A new player claims a name, wins, and the site shows the title move. | Names are live, and the site is live from a branch. No win on the real Box has moved a title. |
| 6 | **The network** | The operator auction, Bet on X, B17, and 0G once credits arrive. | An operator wins a licence and registers a Box; both new games play a round. | Not started, apart from an operator site on a branch. |

### The demo

About four minutes, at the table:

1. A judge taps a badge, gets tokens and claims a name.
2. They swap at the tap discount in the lobby and stake into a Stock Duel.
3. They play best of three against one of us, with live stock prices.
4. The winner is paid in seconds, the fee is burned on chain, and the champion title moves on the site.

Until the Box is on chain, the site's Story shows the ENS half in a browser, with a test badge and the demo Box.

> [!IMPORTANT]
> **Before judging:** the token, pool and hook are live, the badges are charged, the Box is on stable Wi-Fi, the
> relayer is funded, and `main` carries the addresses that are live.

### Submission

- [ ] This repo, public, with a README that points to the exact Uniswap contracts and lines.
- [ ] `FEEDBACK.md` and the Uniswap feedback form.
- [ ] The live site's link for ENS (https://gamebox-names.pages.dev), and every contract address.
- [ ] A demo video under three minutes.

## Team

[beingentangled](https://github.com/beingentangled) ·
[saithyasivadas](https://github.com/saithyasivadas) ·
[Athuli7](https://github.com/Athuli7) ·
[lizgeorge1](https://github.com/lizgeorge1) ·
[0xgeorgemathew](https://github.com/0xgeorgemathew)

<br>

<p align="center"><sub>Ethereum Game Box · ETHGlobal Mumbai 2026</sub></p>
