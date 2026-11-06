# apps/box

`@egb/box`: the Game Box itself. A Node server on the Raspberry Pi and the screen it serves to the Pi's browser.

## What goes here

| Folder | Holds |
|---|---|
| `src/core/` | The Box's phase machine, ledger, chain clock, transactions and station views, behind ports: no DOM, no Node |
| `src/server/` | The Box server on the Pi: the core on Node's ports, HTTP, the screen's WebSocket link, the data folder |
| `src/signer/` | The Box key: one `Signer` interface, a HYP2003 token signer (PKCS#11) and a software signer for laptops and tests |
| `src/taps/` | Tap stations: the serial link to the receiver, tap events, and the badge commands (identify, sign) |
| `src/chain/` | Reads and writes: builds Box-signed requests, sends them to the relayer, reads Sepolia and Robinhood Chain |
| `src/games/` | One folder per game (Quick Draw, Stock Duel, Bet on X, B17): its rules and its screens |
| `src/screen/` | The browser UI: lobby, game screens, progress while a transaction lands |
| `src/test-page/` | `/test`: Stations, Badges, Box and Builder tabs to check the Box on the Pi |

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | The demo on Vite's dev server: the whole Box in the browser (`SimLink`). Vite's root is `src/`: `/` goes to `/screen/`. |
| `pnpm dev:box` | The kiosk's screen (`/`) and the test page (`/test`) on Vite's dev server, linked to a Box server on 127.0.0.1:8790 (`/api` and `/link` pass through). |
| `pnpm build` | The demo build into `dist/screen`: what the public demo at https://ethereum-game-box.pages.dev/ serves. |
| `pnpm build:box` | The kiosk's build into `dist/screen`, with the test page in `dist/screen/test/`: what the Box server serves. |
| `pnpm start` | The Box server (`node src/server/main.ts`); settings in `src/server/README.md`. |
| `pnpm typecheck` | The screen (DOM), the core (ES2023 alone) and the server (Node) against their own platforms. |
| `pnpm test` | Vitest. |

## Depends on

`@egb/shared` for message digests, ABIs and addresses. It never holds a private key in code: the Box key stays on
the token, and the relayer pays the gas.

## First milestone

The signer and a heartbeat: the token signs, `src/chain/` sends it through the relayer, and the registry accepts it.
