# Taps

The Node side of the tap stations: the receiver's serial port, the stations' links, screens and motors, HaLo
commands over the stations' readers, the badge roster, and the tap state machine that turns each chip landing on a
reader into `touch`, then `done` or `fail`, for the core. The Box server owns one `Taps`; no other process touches
the receiver's port. The serial lines are [`firmware/tap-station/protocol.md`](../../../../firmware/tap-station/protocol.md),
the one spec both sides build from.

```
receiver port ─bytes─▶ scanner ─lines─▶ events (parse) ─▶ taps first ─▶ stations · tap machine · nfc · acks
      ▲                                                                   │            │
      └──────────── commands (format, queued, never awaited) ◀─ screens · buzz · nfc ◀─ halo exec (libhalo)
```

## Using it

```ts
const taps = createTaps({
  receiver: "auto",                // a /dev/serial/by-id path, auto, or fake (EGB_RECEIVER)
  stations: ["df3b9c", "df3d88", "e4ba70"],  // the known stations (EGB_STATIONS), a seat each; seats go by link order
  dataDir,                         // $EGB_DATA: badges.json (badges.fake.json for the fake)
  clock,                           // the core's Clock
  plan: (seat) => core.plan(seat), // asked after each touch
  onTap: (event) => core.tap(event),
});
```

`Taps` is the core's `StationsPort` (`show(seat, view)`, `buzz(seat, "ok" | "no")`), plus `status()`, `stats()`,
`identify(st)`, `roll(st)`, `list(st)`, `roster()`, `press()`, `close()`, `fake` (the fake receiver's controls, or
null) and `probe` (one measurement each, for the bench). `runBench(taps, { count })` in `bench.ts` measures the link;
`pnpm taps:bench` runs it through the server's `POST /api/taps/bench`, or opens the port itself with `--direct`.

## How a tap goes

1. The receiver's `tap` line arrives. A resend of an older tap is ignored (below). Its touch time is worked out from
   the line itself (below), and `touch` goes out at once, with the badge if the roster knows the UID.
2. The core's plan for that seat is asked: `identify`, `random` or `none`.
3. A known chip with `identify` or `none` is `done` there and then: no chip command. The applet is selected
   afterwards, off the tap's clock. The station selects it itself right after every tap and answers the same SELECT
   from its kept answer in ~3 ms, so this costs nothing and leaves the chip selected even when the station's own try
   failed.
4. An unknown chip is read with `get_pkeys` whatever the plan, and the roster records it. A `random` tap then asks
   key 2 for `sign_random`, and the roll is verified against the roster's key-2 identity before `done` carries it.
   The station runs an APDU on whatever chip is on its reader, so every exchange is checked against the tap's own
   chip before it goes out and when its answer comes back: an answer after a `gone` or a newer tap may be another
   chip's, and fails the tap `lifted`. A tap that already ended (a newer tap, the link, the receiver) records and
   rolls nothing.
5. Anything else ends in `fail` with a code: `lifted` (the chip left: a `gone` line, or a newer tap), `radio` (a weak
   link to the chip, or the station's reader stopped), `not-halo`, `refused` (the chip said no), `verify` (its answer
   didn't check out), `link` (the station's link stayed down past its 2 s grace, or the receiver dropped).

6. **The same chip read again is the same tap.** A HaLo with SAK 28 resting on the reader answers the station's
   presence check only now and then, so the station counts a badge held still `gone` and sends a new `tap` for it a
   few ms later. While a tap is running, a `tap` line for its own UID on its station, with no `gone` before it or one
   at most `REJOIN_MS` (500 ms) earlier, carries that tap on: no new touch, and a request the flap broke is retried
   after a reselect. A roll (~0.5 to 1.6 s on the hardware) used to fail `lifted` at every flap, which is why Stock
   Duel's picks failed on the Box with the badge held still. A chip gone for longer fails the tap `lifted`, as before.

Every `touch` ends in `done` or `fail`: when the port closes or the receiver reboots, every open tap fails at once.
Every tap logs its station, seat, badge and plan at the touch, then its end and the real cause of a failure (the
server keeps these lines in `$EGB_DATA/logs/`).
Taps on a station no seat uses are ignored, though the station's status shows the chip.

7. **Seats go by link order.** There's a seat for each known station, up to four. The first station to link is Player
   1's, the second Player 2's; one linked with every seat taken waits on the bench (`NEXT`, `every seat taken - you're
   next`, `mode=shut`). A seat is kept through a dropped link's grace; once its station is lost the bench's
   earliest-linked station takes it, with the seat's last view. The receiver's
   `state` lists stations in the order they first reached it, so a reopened port seats them the same way.
8. **The station knows what a tap means.** Every view carries a `mode` from the seat's tap plan: `shut` when the plan
   is `none` (the station answers a tap with NOT NOW itself, at once), `play` in a game, `open` otherwise.

## Timing that matters

- **Touch time** (`receiver-clock.ts`): `at_us` is mapped onto the Pi's clock by a running minimum of (Pi receive
  time − `at_us`), aged by 100 ppm so crystal drift can't freeze it, unwrapped across the u32's 71-minute wrap, and
  reset when the receiver reboots. The touch is `at_us − radio − resends − read_us − gap_us / 2`, where the radio is
  half the station's last ping and each resend is 20 ms. It is never the time a reply arrived.
- **The read path** (`scanner.ts`, `receiver.ts`): one byte scanner over the port's Buffers, no readline or parser
  chain; complete lines are never copied; a chunk's taps are handed over before its other lines, but never ahead of a
  `ready` or `state` before them (a tap after a reboot's `ready` is the new receiver's, and must not be failed by it).
- **Resends** (`fresh-ids.ts`): a station resends `tap`, `gone` and `signed` until the receiver acks, and the receiver
  acks every copy, so a copy of tap N can arrive after tap N+1. Each station's latest id of each is kept; one that is
  the latest or up to 16 behind it (modulo 2³²) within 6 s of it is a resend and is ignored. A station that rebooted
  counts from 1 again: an id further behind, or later, is taken.
- **The write path**: commands are queued on the port and never awaited; a port that stops taking bytes has its
  commands dropped (counted) rather than queued for ever. A write the kernel won't take is retried with backoff (1 ms
  doubling to 50 ms) for 500 ms, then dropped and counted; a command cut off part way gets a newline ahead of the next
  one. Closing the port cancels a retry, so a reused descriptor is never written.
- **Waits**: an NFC request waits 4 s (the receiver gives up at 3 s), a reselect keeps trying 3 s, a dropped
  link gets 2 s of grace, a screen or buzz ack 1.5 s (the receiver's is 1 s).
- **Applet select**: the Pi sends its SELECT after every tap; the station answers it from its own select's kept
  answer when the bytes match. The AID that chip answered last goes first, on both sides (a miss, `6D00`, costs a
  whole APDU).
- **Ids** start at a random point: a station answers a resend of the id it just ran with the same reply, so a
  restarted server starting at 1 could be handed the last run's answer.

## Modules

| Module | Job |
|---|---|
| `lines.ts` | The serial lines as types: `ReceiverEvent` (receiver → Pi), `ReceiverCommand` (Pi → receiver). |
| `events.ts` | `parseEvent(line)`: one line into a checked `ReceiverEvent`, or the reason it was dropped (`noise`, `json`, `shape`, `unknown`). Never throws; unknown fields are kept. |
| `commands.ts` | `formatCommand(cmd)`: the exact command text. `parseCommand(line)`: back again, for the fake receiver. |
| `scanner.ts` | `LineScanner`: splits Buffers on `\n`, copying only a line cut across chunks; drops a line over 4 KB. |
| `receiver.ts` | `Receiver`: owns the port, parses and hands over every event synchronously (taps first, but not past a `ready` or `state`), writes without waiting, sends `state` after opening (again if unanswered), reports the close at once and reopens with backoff (250 ms to 4 s). Counts bytes, lines, drops and the parse time. |
| `serial.ts` | `serialOpener(path)`: a /dev/serial/by-id path, or `auto` (the receiver's by-id entry, by its USB serial `7C:DF:A1:D5:04:CC`), read through Node's own tty handle in the event loop (raw mode, no DTR/RTS toggling) and written with non-blocking writes on a second descriptor (`ttyWriter`: bounded retries, a `drop` event for a command given up). No native addon. |
| `fresh-ids.ts` | `FreshIds`: each station's latest `tap`, `gone` and `signed` id; `fresh(kind, st, id, now)` says whether a line is new or a resend of an older one. |
| `receiver-clock.ts` | `ReceiverClock`: `at_us` onto Pi ms, and the touch time of a tap line. |
| `stations.ts` | `Stations`: a seat per known station, up to four, by link order (`seated` when one changes hands, `bench()`), each station's link, signal, ping, reader and chip; the 2 s link grace (`lost`), `whenUp(st)`; ping and press-report samples. |
| `samples.ts` | `Samples`: a fixed ring of the latest numbers. |
| `acks.ts` | `Acks`: commands waiting on their answer by id (buzz, screen, press), with timeouts and Pi-side times. |
| `screen-payload.ts` | `screenPayload(view, ttl)`: a `StationView` as the station's `key=value` payload, each value cut to its line, at most 200 bytes. |
| `screens.ts` | `Screens`: sends each station's screen on change, on relink and every 5 s with `ttl=15`; tracks `screen_ok` / `screen_fail` by id and retries a failure after a second. |
| `buzz.ts` | `Buzzer`: one 80 ms pulse for `ok`, two for `no`, each with its id; counts the answers. |
| `nfc.ts` | `Nfc`: `nfc <st> <id> …` requests, one in flight per station and the rest queued, 4 s timeouts, errors typed (`errors.ts`). |
| `errors.ts` | `NfcError` (`transport`, `no-chip`, `reader-dead`, `bad-request`, `link`, `closed`), `NotHaloError`, `VerifyError`. |
| `halo-exec.ts` | `ChipSession`: libhalo's `execHaloCmd` over a station's reader. Wraps each HaLo command in its APDU, sends signing commands (`sign`, `sign_random`, `sign_challenge`) as `sign`, selects the applet once, refuses an exchange and drops its answer once the chip has left, and after a radio or RF error reselects and retries while the chip is on the reader. `AidMemory`: each chip's applet ID. |
| `eth.ts` | Addresses from public keys (EIP-55), and the signers a DER signature recovers to. |
| `chip-ops.ts` | `readKeys` (get_pkeys: key 1's and key 2's addresses) and `rollRandom` (key 2's sign_random, verified against the given identity; the roll is payload bytes 4–8). Key 1 never signs. |
| `roster.ts` | `Roster`: UID → keys and a local label (`nova`, shown upper-cased), in `badges.json`, written atomically (`server/files.ts`). `badgeOf(entry)`: `{ address: key 2, name: label }`. |
| `tap-machine.ts` | `TapMachine`: one tap from its line to `done` or `fail` (above). |
| `taps.ts` | `createTaps(options)`: everything above wired together; the API the server, the test page and the bench use. |
| `fake/sim-badge.ts` | `SimBadge`: a HaLo with real secp256k1 keys (deterministic per name) answering the applet select (Arx or legacy AID), `get_pkeys` and key 2's `sign_random` with its counter, signed as a chip signs. |
| `fake/fake-receiver.ts` | `FakeReceiver`: a duplex stream the `Receiver` owns instead of a serial port, speaking the exact lines, with simulated stations (pings, taps and gones, buzz and screen acks, NFC answers, `signed`) and five badges. Like the hardware, a station selects the applet right after the tap and answers the Pi's identical SELECT from its kept answer. `place`, `lift`, `linkDown`, `linkUp`, `unplug`, `plug`, `status`, `heard`. `EGB_RECEIVER=fake`. |
| `bench.ts` | `runBench(taps, { count })`: pings, press both ways, serial write → reply, buzz → `buzz_ok`, screen → `screen_ok`, `nfc list`, the idle event loop's delay and the parse cost; median, p95, p99, max. `formatReport` prints it. |
| `bench-cli.ts` | `pnpm taps:bench`: asks the running server (`POST /api/taps/bench`), or `--direct[=port]` with the server stopped. |

## Tests

`pnpm exec vitest run src/taps` (from `apps/box`). The codec reads `protocol.md` at test time and checks that every
example event line parses and every example command round-trips verbatim. The rest cover the scanner, the clock
mapping (the wrap, drift, a reboot), resent ids (`fresh-ids`), the tty writer (a full buffer, the give-up and its
drop, a cancelled retry), screens (change, relink, the 5 s resend with `ttl=15`, failures), NFC queueing and errors,
chip ops against simulated badges (a verified roll; one signed by another key fails; an answer after the chip left
is dropped; a roll carried on through a station's gone-and-back flap, and failed when the chip stays away), the tap machine on its own (a tap that ended records nothing), the roster file, and the whole library
against the fake receiver on a fake clock: touch then done or fail, unknown chips read whatever the plan, a known
chip's identify with no chip command, the SELECT answered from the station's kept answer, the AID memory, a lift
mid-roll, a resent older tap, a tap after `ready` in one chunk, the receiver dropping and coming back, and the link
grace.
