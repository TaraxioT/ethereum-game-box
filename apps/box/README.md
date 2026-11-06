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
| `src/signer/`, `src/chain/` | Later, with the chain: the Box key (a HYP2003 token signer) and Box-signed requests through the relayer |
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

`@egb/sdk` for the game contract. Later, `@egb/shared` for message digests, ABIs and addresses. It never holds a private key in code: the Box key stays on
the token, and the relayer pays the gas.

## First milestone

The signer and a heartbeat: the token signs, `src/chain/` sends it through the relayer, and the registry accepts it.
