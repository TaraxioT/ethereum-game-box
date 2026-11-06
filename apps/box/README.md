# apps/box

`@egb/box`: the Game Box itself. A Node server on the Raspberry Pi and the screen it serves to the Pi's browser.

## What goes here

| Folder | Holds |
|---|---|
| `src/core/` | The Box's phase machine, ledger, chain clock, transactions and station views, behind ports: no DOM, no Node |
| `src/server/` | The Box server on the Pi: the core on Node's ports, HTTP, the screen's WebSocket link, the data folder |
| `src/taps/` | Tap stations: the receiver's tty, the tap state machine, HaLo commands over the stations' NFC, the roster, the fakes and the bench |
| `src/builder/` | The game builder: the Designer, the Forge (a confined Claude agent in a child process), the bundler and voice |
| `src/games/` | The team games (Quick Draw, Stock Duel) in the module shape: game.json, rules, screens, icon, blueprint |
| `src/screen/` | The browser UI, in the Grid look: the Box's screens, the team games' screens, the Designer and Build screens, built games' frames, the demo's DEMO tag |
| `src/signer/` | The Box key: the HYP2003 token's signer daemon (`deploy/p256-signer/`), and a software key for the simulator and the tests |
| `src/chain/` | The core's chain port on Sepolia: Box-signed stakes, results, seats, top-ups and refunds through the relayer, followed to paid; reads through the RPC and the Universal Resolver |
| `src/test-page/` | `/test`: Stations, Badges, Box and Builder tabs to check the Box on the Pi |

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | The demo on Vite's dev server: the whole Box in the browser (`SimLink`), the screen standing in for the tap stations. Vite's root is `src/`: `/` goes to `/screen/`. |
| `pnpm dev:box` | The kiosk's screen (`/`) and the test page (`/test`) on Vite's dev server, linked to a Box server on 127.0.0.1:8790 (`/api` and `/link` pass through). |
| `pnpm build` | The demo build into `dist/screen`: what the public demo at https://ethereum-game-box.pages.dev/ serves. |
| `pnpm build:box` | The kiosk's build into `dist/screen`, with the test page in `dist/screen/test/`: what the Box server serves. |
| `pnpm start` | The Box server (`node src/server/main.ts`); settings in `src/server/README.md`. |
| `pnpm typecheck` | The screen (DOM), the core (ES2023 alone) and the server (Node) against their own platforms. |
| `pnpm test` | Vitest. |

## Depends on

`@egb/sdk` for the game contract; `@egb/shared` for the message digests, ABIs and addresses (`deployments/sepolia.json`);
`viem` for Sepolia. It never holds a private key in code: the Box key stays on the token, and the relayer pays the gas.

## Stakes on chain

Players stake fake USDC (5, 10 or 25; 10 first) on Sepolia, or play for the game's title or its open championship
with no USDC (the result alone goes on chain). When both seats sign, the match opens at once and the Box sends a
`Stake` (its round from `rounds.json`) to the relayer's `/duel/open`; the result goes as a `Result` with the same round
to `/box/result` once the open is done, and one transaction pays the pot, moves the title and scores the championship.
The tx bar shows each transaction's real hash, linked to Etherscan. The lobby tops a badge up and claims its player
name. The browser demo runs the same core on the demo chain in memory.
