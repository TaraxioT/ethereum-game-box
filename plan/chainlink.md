# Chainlink build plan: CRE and CCIP

Targets two prizes: **Best workflow with CRE** ($1,500) and **Best use of CCIP 2.0** ($3,500). No deployed contract
is redeployed. Everything below is new and sits beside what is in `deployments/sepolia.json`.

Checked against docs.chain.link on 2026-11-07.

## What the docs say

| Fact | Consequence |
| --- | --- |
| CRE supports **Robinhood Testnet** (CLI 1.30+, TS SDK 1.19+), **not Robinhood Chain mainnet**. | The workflow can't use the EVM read capability on mainnet. It reads the mainnet pools with the **HTTP capability** calling `eth_call` on a Robinhood RPC. That still counts as "blockchain + external API". |
| CRE writes go through a forwarder that calls `onReport(metadata, report)` on a consumer (`ReceiverTemplate` → `_processReport`). | Sepolia forwarders: simulation `MockKeystoneForwarder` `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`, production `KeystoneForwarder` `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`. `setForwarderAddress` switches between them, so no redeploy is needed. |
| Simulation uses the mock forwarder, which sends no workflow metadata. | Leave workflow ID and author checks off for the simulation demo; turn them on if we deploy the workflow. |
| A simulation with `cre workflow simulate --broadcast` qualifies. Deployment is optional. | Plan for simulation; deployment is a stretch goal. |
| CCIP Sepolia router `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59`, chain selector `16015286601757825753`. Fee tokens: LINK, WETH, GHO, native ETH. | Pay fees in native Sepolia ETH, so we need no LINK. |
| Sepolia's outbound lanes are 2.0.0 to **Base Sepolia**, Avalanche Fuji, BNB Testnet and others; Arbitrum Sepolia is 1.6.0. I found no Robinhood Testnet lane. | Destination: **Base Sepolia** (a 2.0 lane, and CRE supports it too). |
| CCIP 2.0 receivers override `getCCVsAndFinalityConfig`. Chainlink advises **building `extraArgs` off chain** (V3 on 2.0 lanes) and passing them in, never hard-coding them. | `TrophySender` stores `extraArgs` in a variable the admin can change. The Foundry starter kit's extraArgs helper builds it. |

## The design

```
                 every 15 min (cron)                         CupClosed log (Sepolia)
                        │                                              │
        ┌───────────────▼──────────────┐              ┌────────────────▼───────────────┐
        │ CRE workflow  market-close   │              │ CRE workflow  trophy           │
        │  HTTP: eth_call the 20 pools │              │  EVM read: getCup(id), top(id) │
        │   on Robinhood Chain mainnet │              │  report(cupId, winner, game,   │
        │  HTTP: stock quote API       │              │          label, prize)         │
        │  median + premium/discount   │              └────────────────┬───────────────┘
        │  report(epoch, prices[])     │                               │ writeReport
        └───────────────┬──────────────┘                               ▼
                        │ writeReport               TrophySender (Sepolia, ReceiverTemplate)
                        ▼                             ccipSend → Base Sepolia, fee in ETH
        StockPrices (Sepolia, ReceiverTemplate)                        │ CCIP 2.0
        snapshot per epoch                                             ▼
                        │                           TrophyCabinet (Base Sepolia, CCIPReceiver)
                        ▼                             mints a soulbound trophy to the champion
        Box: deals Stock Duel from the latest snapshot
```

Both workflows live in one CRE project, so CRE is the one orchestration layer, and CCIP carries the result across
chains. A referee hot key is never involved: the trophy is triggered by a cup closing on chain.

### Contracts (`contracts/src/chainlink/`)

1. **`ReceiverTemplate.sol`**, copied from Chainlink's guide (or imported from `@chainlink/contracts`, if the
   package ships it).
2. **`StockPrices.sol`** (Sepolia). `_processReport` decodes `(uint64 epoch, Quote[] quotes)` with
   `Quote { bytes8 ticker; uint64 price; uint64 avgPrice; int32 change24hBps; uint64 liquidity; int32 premiumBps }`.
   It refuses a stale or repeated epoch, which also stops replayed reports. Stores `latestEpoch` and
   `snapshot(epoch)`, and emits `PricesUpdated(epoch)`.
3. **`TrophySender.sol`** (Sepolia). `ReceiverTemplate` + `IRouterClient`. `_processReport` decodes
   `(uint256 cupId, address winner, string game, string label, uint256 prize)`. It refuses a cup it has already
   sent, then `ccipSend`s to `TrophyCabinet` and pays the fee in ETH from its balance. The admin can set the
   destination selector, the receiver and `extraArgs`. Emits `TrophySent(cupId, messageId)`.
4. **`TrophyCabinet.sol`** (Base Sepolia). `CCIPReceiver`, with an allowlist of `(Sepolia selector, TrophySender)`
   and a `getCCVsAndFinalityConfig` override. It mints an ERC-721 trophy that can't be transferred:
   `tokenURI` is an on-chain SVG with the game, the cup label and the prize.
5. Forge tests for all three, using CCIP's local simulator for the CCIP path (check that it supports 2.0; if it
   doesn't, mock the router).
6. Deploy scripts `DeployStockPrices.s.sol` and `DeployTrophy.s.sol`. Add the addresses to `sepolia.json` and a new
   `deployments/base-sepolia.json`; the deployments loader learns the second file.

### CRE project (`apps/cre/`, `@egb/cre`)

- `project.yaml`: targets `ethereum-testnet-sepolia`; secrets for the Robinhood RPC and the quote API key go in
  CRE secrets, never in the repo.
- `market-close/`: a cron trigger. It reads the 20 pools (`slot0` and liquidity) over HTTP `eth_call`, using the
  pool list `deck.ts` was built from, and fetches the stock quotes. Nodes reach consensus with median aggregation.
  It then encodes a report and writes it.
- `trophy/`: a log trigger on `Championships.CupClosed`. It reads `getCup(id)`, builds a report and writes it.
- The deck's 20 tickers and their pool addresses move to `packages/shared`, so the Box and the workflow share
  one list.
- Record both simulations: `cre workflow simulate market-close --broadcast` and the trophy run, with a real
  `CupClosed` transaction hash.

### Box

- Stock Duel's rules are pure and replayable from a transcript, and a built game imports only its own files. So a
  game can't fetch prices itself. The Box reads `StockPrices.latestEpoch()` and the snapshot when a match starts,
  passes it to the game as a start input, and **records the epoch in the transcript** so a referee can replay the
  match. That is an SDK change (a new start-input field), and it's the biggest piece of Box work here.
- The card gets a fifth stat, **premium**: how far the token trades above or below the real stock. Roll order
  becomes `% 5`, so update the rules tests.
- The Box's honours or cup screen shows "Trophy sent to Base Sepolia" with a CCIP Explorer link once `TrophySent`
  appears.

## Order of work

1. Contracts and forge tests: `StockPrices`, `TrophySender`, `TrophyCabinet`.
2. Deploy `StockPrices` and `TrophySender` (Sepolia, mock forwarder) and `TrophyCabinet` (Base Sepolia). Set both
   allowlists and fund `TrophySender` with Sepolia ETH.
3. CRE project, `market-close` workflow: simulate with `--broadcast` until `PricesUpdated` lands.
4. `trophy` workflow: close a test cup, simulate, and watch the message on CCIP Explorer and the mint on Base Sepolia.
5. Box: snapshot start-input, premium stat, trophy link. Then `pnpm typecheck`, `pnpm test`, and a run on the Pi
   with real badges.
6. Stretch: deploy the workflows, switch to the production forwarder and turn on workflow ID checks.

## Decisions for the team

- **The "Sepolia only" rule.** `TrophyCabinet` lives on Base Sepolia. CLAUDE.md and the plan page need an exception
  ("Base Sepolia, for CCIP trophies only").
- **The quote API.** It needs a free stock quote source that CRE's HTTP capability can call (an API key in CRE
  secrets). Without one, the workflow still qualifies on the Robinhood RPC alone, but the premium stat goes away.
- **The SDK change.** Passing a price snapshot into games is new. If that's too much this week, the fallback is for
  the Box to regenerate `deck.ts` from `StockPrices` before a build. That's a weaker "meaningfully used" story.

## Not doing

- GBX as a cross-chain token: GBX has no owner, `getCCIPAdmin()` or admin role, so it can't be registered without a
  redeploy that would break the pool, hook, staking and lease.
- FakeUSDC across chains: CCIP doesn't support it.
