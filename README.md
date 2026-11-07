<div align="center">

<img src=".github/assets/hero.svg" width="100%" alt="A badge tap reaches the Game Box, which signs with its hardware key and settles on Sepolia">

<h1>
  <img src="deploy/pi/egb.svg" width="44" height="44" alt="Ethereum Game Box logo" align="center">&nbsp;
  Ethereum Game Box
</h1>

<p><strong>A tabletop console where friends tap NFC wallet badges to play for prizes on Ethereum.</strong></p>

<p>
  <a href="https://gamebox-names.pages.dev"><b>Explore the live names</b></a> &nbsp;·&nbsp;
  <a href="ens-usage.md"><b>ENS integration</b></a> &nbsp;·&nbsp;
  <a href="0g-usage.md"><b>0G integration</b></a> &nbsp;·&nbsp;
  <a href="#run-it-locally"><b>Run it locally</b></a>
</p>

<sub>Built at ETHGlobal Mumbai 2026. Game Box contracts run on Sepolia. Matches use test USDC.</sub>

</div>

<br>

## A console for a table of friends

The Box is a Raspberry Pi 5 with a touchscreen, speaker, wireless NFC tap stations, and a hardware signing key. Players carry HaLo NFC wallet badges. Nobody at the table needs a wallet app, ETH for gas, or transaction pop-ups.

1. Tap a badge to receive 100 test USDC, then claim a name such as `alice.gamebox.eth`.
2. Choose a game. Each player taps to stake.
3. Play. The Box signs the result, or a store game's AI judge decides the payout.
4. The contract pays the players. A built-in game's signed result can also move its ENS title and score an open cup.

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"14px","textColor":"#c6cee0","primaryColor":"#10141e","primaryTextColor":"#f3f5fa","primaryBorderColor":"#2a3245","lineColor":"#7d8aa6","edgeLabelBackground":"#10141e","clusterBkg":"#0b0e16","clusterBorder":"#2a3245","titleColor":"#c6cee0","actorBkg":"#10141e","actorBorder":"#2ec4ff","actorTextColor":"#f3f5fa","actorLineColor":"#7d8aa6","signalColor":"#7d8aa6","signalTextColor":"#7d8aa6","labelBoxBkgColor":"#1a1206","labelBoxBorderColor":"#ff9f1c","labelTextColor":"#ffd9a3","loopTextColor":"#7d8aa6","noteBkgColor":"#1a1206","noteBorderColor":"#ff9f1c","noteTextColor":"#ffd9a3","activationBkgColor":"#1a1206","activationBorderColor":"#ff9f1c","sequenceNumberColor":"#07090f"},"sequence":{"width":190,"actorMargin":30}}}%%
sequenceDiagram
    autonumber
    actor P as Players
    participant B as Box · Pi + P-256 key
    participant R as Cloudflare relayer
    participant J as 0G judge
    participant C as Sepolia contracts
    P->>B: Tap badge
    B->>R: Signed name claim
    R->>C: 100 test USDC · alice.gamebox.eth
    P->>B: Tap to stake
    B->>R: Signed stake
    R->>C: Stake into the pot
    P->>B: Play
    alt Built-in game
        B->>R: Signed result
        R->>C: Pay the players · move title · score cup
    else Store game
        B->>J: Match log
        J->>R: Signed verdict or refund
        R->>C: Pay the players or refund
    end
    opt Unsettled after one hour
        P->>C: Anyone triggers a refund
    end
```

> [!NOTE]
> If a match remains unsettled, anyone can trigger a refund after one hour.

## What makes it work

| Technology | What we built with it | Code |
| --- | --- | --- |
| **NFC chips** | HaLo badges hold each player's keys. The Pi reads public keys and verifies chip-signed random rolls through libhalo. | [Chip operations](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/apps/box/src/taps/chip-ops.ts#L36-L83) |
| **Hardware P-256** | A HYP2003 USB token signs name claims, stakes, and results. Its private key stays in the token. Ethereum checks signatures through `P256VERIFY`. | [Token signing](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/deploy/p256-signer/hyp2003_signer.py#L229-L244) · [Onchain verification](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/contracts/src/box/P256.sol#L15-L25) |
| **ENSv2** | Box licenses, player names, expiring champion titles, and cups with live standings. A finished cup becomes a trophy name owned by its winner. | [Box names](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/contracts/src/names/GameBoxNames.sol#L145-L175) · [Cup trophies](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/contracts/src/names/Championships.sol#L116-L140) |
| **0G Compute** | An AI judge reads store match logs through private inference. The verifier checks each turn's enclave signature before accepting its reply. | [Private inference](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/apps/verifier/src/proxy.ts#L63-L106) · [Enclave checks](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/apps/verifier/src/tee.ts#L94-L112) |
| **0G Storage** | The verifier commits each audit hash on Sepolia and queues the record for upload after settlement. | [Audit upload](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/apps/verifier/src/zg-storage.ts#L112-L132) |
| **Cloudflare** | Workers and Durable Objects relay transactions, host the store, and coordinate judging in Containers. The relayer pays the gas. | [Relayer](apps/relayer/README.md) · [Verifier container](https://github.com/TaraxioT/ethereum-game-box/blob/980270430130e4dfa2e884d82997b72c821d12c7/apps/verifier/src/container.ts#L32-L50) |

Operators stake GBX to activate or extend a Box's ENS license. Expired or inactive Boxes cannot authorize game operations.

> [!IMPORTANT]
> The tap is the player's consent to stake. The Box signs the stake with its hardware key; the badge does not sign a spending transaction.

## The games

| Game | How it plays |
| --- | --- |
| [Quick Draw](apps/box/src/games/README.md#quick-draw-quick-draw) | The first tap after "draw" wins. |
| [Stock Duel](apps/box/src/games/README.md#stock-duel-stock-duel) | A best-of-three card game played with stocks. |
| [Tap Rush](apps/store/sample/tap-rush/manifest.json) | The most taps in ten seconds wins the pot. A 0G-powered judge counts the Box's recorded taps. |
| [Rigged game](apps/store/sample/rigged-game/manifest.json) | Deliberately reports inflated scores. The judge compares its claims with the Box's tap log and returns `cannot_judge`, which refunds the stakes. |

## How the pieces connect

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"14px","textColor":"#c6cee0","primaryColor":"#10141e","primaryTextColor":"#f3f5fa","primaryBorderColor":"#2a3245","lineColor":"#7d8aa6","edgeLabelBackground":"#10141e","clusterBkg":"#0b0e16","clusterBorder":"#2a3245","titleColor":"#c6cee0","actorBkg":"#10141e","actorBorder":"#2ec4ff","actorTextColor":"#f3f5fa","actorLineColor":"#7d8aa6","signalColor":"#7d8aa6","signalTextColor":"#7d8aa6","labelBoxBkgColor":"#1a1206","labelBoxBorderColor":"#ff9f1c","labelTextColor":"#ffd9a3","loopTextColor":"#7d8aa6","noteBkgColor":"#1a1206","noteBorderColor":"#ff9f1c","noteTextColor":"#ffd9a3","activationBkgColor":"#1a1206","activationBorderColor":"#ff9f1c","sequenceNumberColor":"#07090f"},"sequence":{"width":190,"actorMargin":30}}}%%
flowchart TB
    subgraph table[" At the table "]
        direction LR
        Badge[HaLo NFC badge] --> Station[ESP32 tap station]
        Station -->|ESP-NOW and USB| Box[Raspberry Pi]
        Key[HYP2003 P-256 token] -->|Signs operations| Box
    end
    subgraph cf[" Cloudflare "]
        Relayer[Cloudflare relayer]
        Judge[Verifier and Container]
    end
    subgraph zg[" 0G "]
        Compute[0G Compute]
        Storage[0G Storage]
    end
    subgraph eth[" Sepolia "]
        Chain[Sepolia contracts]
        ENS[ENS names, titles and cups]
    end
    Box --> Relayer
    Relayer --> Chain
    Box -->|Store match log| Judge
    Judge <-->|Private inference| Compute
    Judge -->|Signed verdict or refund| Relayer
    Judge -->|Audit record after settlement| Storage
    Chain --> ENS
    ENS --> Site[Public site]
    Chain -->|Contract events| Site

    classDef hw fill:#06141c,stroke:#2ec4ff,color:#b8ecff
    classDef chain fill:#1a1206,stroke:#ff9f1c,color:#ffd9a3
    classDef svc fill:#10141e,stroke:#7d8aa6,color:#f3f5fa
    class Badge,Station,Box,Key hw
    class Chain,ENS chain
    class Relayer,Judge,Compute,Storage,Site svc
```

The public site reads ENS through the Universal Resolver and discovers names from contract events. It has no backend or database.

## Real matches on Sepolia

<table>
  <tr>
    <td width="50%" valign="top">

**Tap Rush paid out.** `mumbai-01`, round 51, paid a 20 test-USDC pot to the winner. [Settlement transaction](https://sepolia.etherscan.io/tx/0xbaf667d1f6c44ce63687ac615895b28f8b9db7d0cfa98cedf8de4e984c2684a8).

</td>
    <td width="50%" valign="top">

**The rigged game refunded.** Round 55 ended with `cannot_judge` and returned each player's 5 test USDC. [Refund transaction](https://sepolia.etherscan.io/tx/0x532eb497e040530385df54ed3f37c2b80f02eb3dd42ea4f704d37d01316c2faa).

</td>
  </tr>
</table>

See [0G usage](0g-usage.md) for live verifier responses, audit status, and code links. Contract addresses live in [deployments/sepolia.json](deployments/sepolia.json).

## Run it locally

Requires Node.js 26 or newer and pnpm 12.3.4. Contract checks also need Foundry and the contract dependencies.

```sh
cp .env.example .env
pnpm install
pnpm --filter @egb/box build:box
EGB_RECEIVER=fake EGB_FORGE_PROVIDER=sim node apps/box/src/server/main.ts
```

Open <http://127.0.0.1:8790/> to use the Box with simulated badges and stations.

```sh
pnpm typecheck
pnpm test
pnpm contracts:install
pnpm contracts:test
pnpm firmware:test
```

The store's full local integration run is `pnpm store:e2e`. It uses real Workers, a container, the Box, and contracts on Anvil, with 0G and hardware faked. See [its prerequisites](apps/store-e2e/README.md#run). For hardware setup, see the [Pi guide](deploy/pi/README.md), [signer guide](deploy/p256-signer/README.md), and [tap-station firmware](firmware/tap-station/README.md).

## Repository

| Path | Responsibility |
| --- | --- |
| [apps/box](apps/box/README.md) | Pi server, touchscreen, NFC taps, and games |
| [apps/relayer](apps/relayer/README.md) | Signed requests and gas payments |
| [apps/verifier](apps/verifier/README.md) | AI judge, enclave checks, verdicts, and audit uploads |
| [apps/store](apps/store/README.md) | Game listings and bundles in R2 |
| [apps/web](apps/web/README.md) | Public ENS directory, titles, and cups |
| [apps/demo-box](apps/demo-box/README.md) | Software-key demo Box and ENS heartbeat |
| [contracts](contracts/README.md) | Names, pots, championships, GBX, licenses, and staking |
| [packages/sdk](packages/sdk/README.md) | Game manifests and match-log protocols |
| [packages/shared](packages/shared/README.md) · [packages/ui](packages/ui/README.md) | Shared types, ABIs, addresses, and UI |
| [apps/store-e2e](apps/store-e2e/README.md) | Local store integration scenarios |

## Team

<table>
  <tr>
    <td align="center"><a href="https://github.com/beingentangled"><img src="https://github.com/beingentangled.png?size=120" width="64" alt=""><br><sub><b>beingentangled</b></sub></a></td>
    <td align="center"><a href="https://github.com/saithyasivadas"><img src="https://github.com/saithyasivadas.png?size=120" width="64" alt=""><br><sub><b>saithyasivadas</b></sub></a></td>
    <td align="center"><a href="https://github.com/Athuli7"><img src="https://github.com/Athuli7.png?size=120" width="64" alt=""><br><sub><b>Athuli7</b></sub></a></td>
    <td align="center"><a href="https://github.com/lizgeorge1"><img src="https://github.com/lizgeorge1.png?size=120" width="64" alt=""><br><sub><b>lizgeorge1</b></sub></a></td>
    <td align="center"><a href="https://github.com/0xgeorgemathew"><img src="https://github.com/0xgeorgemathew.png?size=120" width="64" alt=""><br><sub><b>0xgeorgemathew</b></sub></a></td>
  </tr>
</table>