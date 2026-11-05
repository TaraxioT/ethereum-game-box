# apps/box

`@egb/box`: the Game Box itself. A Node server on the Raspberry Pi and the screen it serves to the Pi's browser.

## What goes here

| Folder | Holds |
|---|---|
| `src/server/` | HTTP and WebSocket server; the screen talks to it, nothing else does |
| `src/signer/` | The Box key: one `Signer` interface, a HYP2003 token signer (PKCS#11) and a software signer for laptops and tests |
| `src/taps/` | Tap stations: the serial link to the receiver, tap events, and the badge commands (identify, sign) |
| `src/chain/` | Reads and writes: builds Box-signed requests, sends them to the relayer, reads Sepolia and Robinhood Chain |
| `src/games/` | One folder per game (Quick Draw, Stock Duel, Bet on X, B17): its rules and its screens |
| `src/screen/` | The browser UI: lobby, game screens, progress while a transaction lands |
| `src/test-page/` | One tab per feature with a button for every chain call, tap and signature, to check it on the Pi |

## Depends on

`@egb/shared` for message digests, ABIs and addresses. It never holds a private key in code: the Box key stays on
the token, and the relayer pays the gas.

## First milestone

The signer and a heartbeat: the token signs, `src/chain/` sends it through the relayer, and the registry accepts it.
