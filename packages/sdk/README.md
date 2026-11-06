# packages/sdk

`@egb/sdk`: the contract between the Box and its games. Team games (in `apps/box/src/games/`) and games the builder
makes both write against it, and the Box's core, server and screen read it. Pure TypeScript with no DOM and no Node:
a built game's rules run in a locked-down Node child and its screen in a sandboxed frame, so nothing here may reach
for either platform. The one browser-only piece, the screen contract, is its own entry. So is the game bundle format,
`@egb/sdk/bundle`, which needs WebCrypto and DecompressionStream, and a built game has no use for.

## What goes here

| Module | Holds |
|---|---|
| `seat.ts` | `Seat` (0 is Player 1, 1 is Player 2), `SEATS`, `other()` |
| `random.ts` | Seeded randomness for rules: `hash32`, `mulberry32`, `shuffle`. Tested in `random.test.ts` |
| `rules.ts` | `GameRules<S, E>` (pure `start` / `step` / `outcome`), `Outcome`, and a built game's `BuiltRules<S>` with `stations(state)` and its events, `BuiltEvent` (`tick`, and `tap` at its touch time with the verified roll) |
| `station.ts` | `StationView`, what a tap station's OLED shows (`tag` ≤ 3, `big` ≤ 32 and `small` ≤ 40, scrolling when too wide, the `hold` / `sign` / `done` / `fail` / `nope` overrides, and the `mode`: `open`, `play` or `shut`), `stationView()` to build one cut to fit, and `printable()` |
| `manifest.ts` | `GameManifest`, the shape of `game.json`, `manifestProblems()` to check one, the checks it shares with a bundle's manifest, and `PLAYER_LIMITS` |
| `runner.ts` | The rules-runner protocol: JSON lines over a built game's child's stdio (`start`, `step`; `ready`, `state`, `error`), and `MAX_MESSAGE` |
| `frame.ts` | The frame channel: what the kiosk posts a built game's screen (`init`, `update`) and the only things it may post back (`ready`, `error`) |
| `transcript.ts` | `Transcript`: one line per match in the session log, from which records are rebuilt |
| `match-log.ts` | `MatchLog`, what the verifier judges, `LOG_LIMITS`, `logProblems()` to check one from an untrusted Box, and `logTextProblems()` to check its exact text, which is what the verifier gets. Tested in `match-log.test.ts` |
| `check.ts` | `isRecord` and `strayKey`, for parsed, untrusted JSON, and `hasOneReading`, for its text |
| `bundle/` | `@egb/sdk/bundle`: the game bundle format, its one reader and its one packer. Its own README says more |
| `screen.ts` | `@egb/sdk/screen`: `GameScreen`, what a built game's `screen.ts` exports by default (browser only) |

## Rules

- Rules are pure: time and seeds arrive in events, never from a clock or `Math.random`.
- A tap's time is when the chip touched the reader, never when its answer reached the Box.
- Anything a game shows on a station goes through `stationView()`, so it fits the 72×40 OLED.
