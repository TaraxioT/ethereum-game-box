# firmware/tap-station

Arduino firmware for the tap stations and the receiver that links them to the Box. A chip on a station's reader
buzzes its motor at once, turns its LED blue and reaches the Pi as a `tap`; the Pi can buzz any station, put its own
words on a station's OLED, and use a station's reader for APDUs. Up to four stations share one receiver over ESP-NOW,
each named by the last three bytes of its MAC (`e4ba70`). [`protocol.md`](protocol.md) is the serial spec between the
receiver and the Box: the one contract for both sides.

Taps must feel instant: nothing waits on the USB serial, the radio never dozes, and a station answers before it logs.

## The boards

| Sketch | Board | Does |
|---|---|---|
| [`station/`](station/station.cpp) | 01Space ESP32-S3 0.42″ OLED: SSD1306 72×40 on SDA 41 / SCL 40, WS2812 LED GPIO39, BOOT GPIO0, motor GPIO16, PN532 on `Wire1` SDA 35 / SCL 36 (400 kHz, 0x24, IRQ 37 optional) | Reads chips and sends taps; buzzes on a tap or when the Pi asks; shows the Pi's words and the holder's feedback on the OLED and the LED; BOOT toggles the receiver's LED |
| [`receiver/`](receiver/receiver.cpp) | ESP32-C3 on the Pi's USB: LED A GPIO12, LED B GPIO13 (kept off), BOOT GPIO9 | Turns the stations' packets into JSON lines for the Pi and the Pi's commands into packets; LED A is toggled by any station's BOOT; its BOOT toggles the first linked station's LED |

BOOT is a normal button once a board runs (held through power-up or reset it starts the flasher instead). RESET can't
be read. On the S3 the red LED is the power light; the RGB LED is the program's.

### Wiring the station

All on the right-hand header (USB at the top). PN532 in I²C mode (switches 1 ON, 2 OFF), powered from the S3's 3.3 V
so its I²C lines stay at 3.3 V:

| PN532 | S3 | |
|---|---|---|
| GND | G | |
| VCC | 3V | not 5V |
| SDA | 35 | the S3's second I²C bus (`Wire1`); the OLED has the first, on GPIO41/40 |
| SCL | 36 | |
| IRQ | 37 | optional: the driver finds out at start whether it's wired (neither station has it today) |

The motor module: **IN → 16**, **VCC → 5V** (USB power, so its start-up surge doesn't sag the 3.3 V regulator that
feeds the radio and the PN532), **GND → the PN532's spare GND** (the S3 has one G pin).

## Layout

| Path | Holds |
|---|---|
| `lib/EgbLink/` | The library both sketches use (below) |
| `station/` | The station sketch, one module per job (below) |
| `receiver/` | The receiver sketch (below) |
| `test/` | Host tests: plain C++ with the host compiler, no Arduino |
| `tools/frame.py` | A station's OLED as a PNG, over its own serial port |
| `scripts/` | `test.sh`, `build.sh`, `flash.sh` (`pnpm firmware:test`, `firmware:build`, `firmware:flash`) |

Each `.ino` is a one-line stub; the code is in the `.cpp` files beside it. Everything under `egb/` without Arduino in it
is plain C++, and so are the pure station and receiver headers, so the host tests build them as they are.

### `lib/EgbLink`

| Module | Job |
|---|---|
| `egb/config.h` | The constants: channel, ping, link timeout, resend policies, limits, buzz; `sinceMs` (signed time compare) |
| `egb/wire.h` | The packets: one small packed struct per kind behind a 4-byte head (magic, kind, the sender's flags, tries); only `Tap`, `Gone` and `Signed` carry the chip. Reading checks the magic, the kind and the exact length |
| `egb/resend.h` | The one resend slot, for packets, NFC requests, screens and stats: sent again on a clock until acked, with a send cap or a deadline; a pool of them. The clock is passed in |
| `egb/stations.h` | The receiver's station table: names, link up/down, what the Pi was last told |
| `egb/hex.h` | Hex out (upper case) and in (either case) |
| `egb/json.h` | The JSON line writer: one fixed buffer, no heap, no printf; an overflowing line comes out empty and is dropped whole |
| `egb/lines.h` | The serial line reader, and the recovery of a command glued to echoed junk (the first-command bug, below) |
| `egb/radio.h` | Wi-Fi and ESP-NOW up for latency; peers at 24 Mbps; sending with this board's flags in every packet |
| `egb/press.h` | The BOOT press: an edge interrupt wakes a high-priority task that sends, resends and reports |
| `egb/serial.h` | The USB serial that never waits: whole lines or nothing, drops counted |

### `station/`

| Module | Job |
|---|---|
| `station.cpp` | `setup()`, and the loop task: the resend slots for taps, gones and signatures, the pings, stats, press reports, the station's own serial |
| `link.cpp` | The radio callback: the receiver's press switches the LED before the ack, a buzz starts the motor before its Got, a screen is acked and handed to the OLED task, an NFC request goes to the NFC task |
| `pn532.cpp`, `pn532_frame.h` | The PN532 driver (I²C frames, 16-byte reads, sleeping waits, bus recovery) and its pure frame code |
| `reader.cpp` | The NFC task: finding the PN532, reading chips, taps and gones, presence checks |
| `serve.cpp` | The Pi's requests (`apdu`, `sign`, `reselect`, `select`, `list`), each id run once |
| `applet.cpp` | The station's own HaLo applet select, the AID each chip answered, and the kept answer |
| `bench.cpp` | `bench` timing runs on the chip on the reader |
| `feedback.h` | The LED/OLED table as one pure function of the shared state (written by the NFC task only, every field atomic) |
| `screen_model.h` | The Pi's screen payload parsed |
| `screen_draw.h` | One OLED frame, drawn with U8g2's C API |
| `oled.cpp` | The OLED task (lowest priority, core 0): draws on change, sends only changed rows, blinks the LED, prints `frame` |
| `led.cpp`, `motor.cpp` | The RGB LED (written only on change, under a lock) and the motor (on at once, off by a timer) |
| `cli.cpp`, `stats.h` | The station's own serial commands, and the stats both it and the link report |

### `receiver/`

| Module | Job |
|---|---|
| `receiver.cpp` | `setup()`, and the loop task: it owns the station table, the slots and every line to the Pi, and sleeps on its inbox |
| `rx.cpp` | The radio callback: a station's press switches LED A before the ack, pings get their pong, taps, gones and signatures their Got; every packet goes on to the loop |
| `stations.cpp` | A station's packets into lines (link, button, nfc first), acks closing the slots |
| `requests.cpp` | The Pi's commands into slots, under the receiver's own wire ids; resends and timeouts |
| `commands.h`, `events.h` | The command parser and the line formats, pure (tested against `protocol.md`'s examples) |

## How it behaves

### Tasks and timing

- **Nothing waits on USB.** Both boards call `Serial.setTxTimeoutMs(0)`; a line that doesn't fit the transmit buffer is
  dropped whole and counted (`stats` `dropped`). Only the station's `frame`, asked for by a reading host, waits (50 ms
  at most).
- **The radio never dozes** (`WIFI_PS_NONE`, set before the mode), sits on channel 1, and unicasts at 24 Mbps.
- **A press is an interrupt** waking a high-priority task that sends at once (a fall after 30 ms up counts; 15 ms up
  after it is a release). The other board switches its LED in its receive callback, then acks. Every 20 ms again,
  25 sends at most, each id counted once on the far side.
- **Taps, gones, signatures and buzzes** go again every 20 ms (25 sends) until a `Got`; NFC requests every 40 ms until
  the reply (3 s at most); screens and stats requests every 40 ms (1 s). One resend slot does all of it.
- **The link** is down after 2.5 s without any packet (not only pings), compared signed. Stations ping every 250 ms,
  broadcast until a receiver answers; a station ignores packets without the receiver's flag (another station's
  broadcasts).
- **Event-driven loops.** Each loop task sleeps on its inbox until a callback, the press task or the USB event task
  posts, or until a resend or a ping falls due. Only one task owns each piece of state; the rest is atomic.
- **The NFC task** (priority 5, core 1) never spins: a PN532 wait sleeps the task and wakes it on the IRQ line when
  it's wired, otherwise every 250 µs on a timer to read the ready bit. The OLED task draws on core 0 at the lowest
  priority.
- **No heap on hot paths:** no `String`, no `printf` to the port (lines are built in stack or static buffers),
  `esp_read_mac` for the MAC, one static JSON writer on the receiver.

### The reader

- **Reads:** one `InListPassiveTarget` with one activation try, so no chip is a quick miss; ISO-DEP chips come back
  activated (the PN532 sends RATS). Each PN532 answer is read 16 bytes first; a longer one is asked for again with a
  NACK and read to its length (reading the longest frame every time cost ~6 ms of I²C a command).
- **Presence:** a resting ISO-DEP chip gets an ISO-DEP R(NAK) every 20 ms, which it answers without changing state
  (~4.3 ms), so the Pi's session carries on. Any other chip is re-read after a 5 ms field cycle. Two misses in a row
  are a lift (`gone`). No checks for 150 ms after a Pi request.
- **The applet:** right after an ISO-DEP chip's `tap` goes out, the station selects the HaLo applet itself, trying the
  SELECT that chip answered last first (else the last chip's), and keeps the answer: the Pi's own SELECT with the same
  bytes, while nothing else has gone to the chip, is answered at once. `reselect` cycles the field (unless only the
  station's own select has talked to the chip since it landed) and selects again (`sel` in the reply).
- **Signing:** a `sign` request shows `HOLD STILL`; the reply goes out before the LED, the log and the `signed`
  packet.
- **The bus:** every search for the PN532 clocks the bus clear (nine clocks and a STOP free a held SDA). A PN532 that
  was cut off mid-transfer (flashing resets the S3, the PN532 keeps its power) can hold SCL low instead: only a power
  cycle frees it, the OLED says `REPLUG / reader hung` and the Pi sees `"nfc":false`. A PN532 that worked this boot and
  goes silent with the bus idle restarts the S3 after 3 s.

### What the person holding the chip sees

The OLED words are the defaults; the Pi may reword each (`hold`, `sign`, `done`, `fail` in a `screen`).

| LED | OLED | Buzz | When |
|---|---|---|---|
| blue, blinking (200 ms) | inverted, slow sweep: `HOLD` / `reading` | one 80 ms | a chip landed, or the app is reading it: until 500 ms after its last request |
| blue, blinking fast (80 ms) | inverted, fast sweep: `HOLD STILL` / `signing` | | a sign request runs, and for 0.6 s after a failed one (the Pi retries at once) |
| green | check mark, `DONE` | | the read ended well: 500 ms after its last good request (the station's own applet select counts), or at the lift |
| green | check mark, `DONE` | two 60 ms | the signature is back |
| red for a second | cross, `AGAIN` / `tap again` | | the sign failed and the Pi didn't retry within 0.6 s |
| red for a second | cross, `TOO SOON` / `tap again` | | the chip left mid-sign |
| white or off | the Pi's screen (`big`, `small`), or `TAP` | | anything else, a chip resting on the reader included; the receiver's BOOT toggles the white |

A result (`DONE`, `AGAIN`, `TOO SOON`) shows for 1.5 s, or until the Pi sends a different screen, whichever comes
first. Then the Pi's screen is back even while the chip stays on the reader: players leave badges on the readers, and
the station follows the game (a resend of the same screen doesn't cut a result short). A reader in trouble wins over
everything: `NO READER` / `check wiring`, or `REPLUG` / `reader hung`; a radio that didn't start shows `NO RADIO` /
`esp-now failed`. The screen has a big line in the largest font that fits (28 px tall for three letters, down to 8 px for ten) and a small line under it; in the top
corners the Pi's `tag` (left), the link dot (filled = linked) and a square while the LED is on (right). Screens from
the Pi: `protocol.md`, "Screens".

### The first-command bug, found and fixed

The first command after the receiver started got no answer. The cause is on the Pi: a freshly enumerated USB tty (the
board just plugged in, power-cycled or flashed) starts in cooked mode with **echo on**. Between the host's `open()`
and its switch to raw mode, Linux echoes back every byte the board sends, so the receiver read fragments of its own
buffered output (`ready`, pings). The last fragment ended mid-line, the host's first command was appended to it
(`{"ev":"ping","st":"e4b` + `state`), and the old receiver ignored unknown lines silently. Reproduced on the old
firmware: after a USB power cycle the first `buzz` got nothing, a second one was answered, and a lone newline sent
first made the first one work.

The fix (`egb/lines.h`): commands are only letters, digits and spaces, and every line the boards print has other
bytes in it (`{"`, `:`, `=`, `,`), so the reader marks where junk ends and takes the command after it, its first word
cut down to the command word it ends with (`e4bstate` → `state`). Echo with no command in it is dropped without an
answer (an answer would only be echoed again); any other line the receiver can't parse gets `bad`. Verified on the
Pi: after a power cycle, a command sent the moment the port opens is answered.

## Build, test, flash

```bash
pnpm firmware:test    # host tests (clang++ or g++), with U8g2's C library for the font tests
pnpm firmware:build   # both sketches, --warnings all, must compile clean; bins in firmware/tap-station/build/
pnpm firmware:flash   # [receiver|p1|p2|all]: copies the merged bins to the Pi and flashes them there
```

- **Tools:** arduino-cli with the esp32 core 3.3.x (`arduino-cli core install esp32:esp32`) and U8g2
  (`arduino-cli lib install U8g2`). FQBNs: station `esp32:esp32:esp32s3:CDCOnBoot=cdc`; receiver
  `esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashFreq=40,FlashMode=dio`.
- **The C3 needs `FlashFreq=40`:** at the default 80 MHz its flash reads back garbage once the bootloader speeds it up.
- **Apple Silicon:** Arduino's bundled ctags is Intel-only; `brew install universal-ctags`, and the build adds
  `--build-property tools.ctags.path=/opt/homebrew/bin` (safe: the `.ino` stubs declare nothing for it to index).
- **Flashing** runs `~/.local/bin/esptool` on the Pi by `/dev/serial/by-id` path (`EGB_PI` names the ssh host,
  default `pi`), and refuses a board whose port something holds (`fuser`): stop the Box server first.
- **After flashing a station its PN532 usually hangs** (`nfc:false`, `REPLUG`). On the Pi 5 the USB ports' power is
  ganged and only drops when every hub's ports are off, which restarts every board (and the USB key):

  ```bash
  sudo sh -c 'for h in 1 3 2 4; do uhubctl -l $h -a off; done; sleep 3; for h in 1 3 2 4; do uhubctl -l $h -a on; done'
  ```

  (`uhubctl -l 1 -a cycle` alone only re-enumerates hub 1's two ports without cutting their power.)
- **Opening a port** resets neither chip when DTR and RTS are left as opening sets them (both together); setting them
  one at a time can reset the board.
- **The original flash of each board** is saved on the Pi in `~/egb-takeover/flash-backup/`
  (`receiver-c3-7cdfa1d504cc.bin`, `p1-s3-dc5475e4ba70.bin`, `p2-s3-dc5475df3d88.bin`, 4 MB each, `SHA256SUMS`);
  `esptool --port <by-id> write-flash 0x0 <file>` puts one back.

### Screenshots

```bash
python3 tools/frame.py /dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_DC:54:75:E4:BA:70-if00 oled.png
```

## Measured

On the Pi, November 2026: the receiver on the Pi's USB, both stations on the desk beside it, a HaLo badge resting on
each reader (UIDs `77592013`, `278D2113`; they answer the legacy applet ID, and the Arx one with `6D00`). Medians, with
p95 and max; 220 of each unless noted. "Round trip" is the receiver's own clock; "Pi" is from the Pi's write to the
answering line read back (pyserial).

| What | P1 `e4ba70` | P2 `df3d88` | Earlier target |
|---|---|---|---|
| Ping round trip | 3.09 ms (p95 5.47, max 8.26), 97.0 % under 6 ms | 2.96 ms (5.70, 7.35), 96.2 % | 3.1 ms, 96–98 % under 6 ms |
| Press C3 → S3 (`press`), LED switched and acked | | 2.80 ms (4.75, 7.32), all first send; Pi 4.91 ms | 2.4–2.8 ms |
| Press S3 → C3 (station `press`) | 2.53 ms (5.31, 22.9) | 2.44 ms (4.19, 11.3) | 2.8 ms |
| `buzz` → `buzz_ok` | 2.89 ms (6.75, 42.2); Pi 4.90 ms | 2.89 ms (5.12, 6.96); Pi 4.91 ms | |
| `screen` → `screen_ok` | 2.91 ms (7.38, 82.6); Pi 5.06 ms | 2.89 ms (5.62, 8.87); Pi 5.01 ms | |
| Chip read (field cycle, then one list) | 29.0 ms, 25.5 of it waiting on the PN532 and the chip | 29.0 ms | 27.4–29.4 ms |
| Tap: chip lands → `tap` sent (`read_us`, 40 taps) | 28.9 ms (29.1, 29.3) | 28.9 ms (29.1, 29.2) | ≤ 30 ms |
| `nfc list` with a badge on the reader | station 63.5 ms, round trip 66.8 ms, Pi 68.9 ms | 63.5 / 66.6 / 68.9 ms | ~35 ms (an empty reader) |
| Applet SELECT sent to the chip | station 20.2 ms (18.4 waiting), round trip 23.2 ms, Pi 25.9 ms | 20.2 / 23.1 / 25.8 ms | 40–75 ms |
| Applet SELECT answered from the station's own | round trip 3.4 ms (p95 9.1) | | |
| `get_pkeys` | station 90.6 ms (83.7 waiting), round trip 94.5 ms, Pi 96.9 ms | 90.6 / 93.6 / 95.9 ms | ~110 ms |
| `sign_random`, key 2 (100 each) | station 335.6 ms, round trip 339.7 ms; 2 of 100 got no reply | 334.8 / 337.8 ms, all 100 | 700–900 ms |
| Presence check (R(NAK)) | 4.3 ms | 4.3 ms | |
| Serial round trip, no radio (`x` → `bad`) | 0.94 ms; a two-packet line (`stats`) 1.94 ms, 1.01 ms with the tty in low-latency mode | | |

Each APDU costs the station ~1.8 ms of I²C (`us` − `wait_us`) and the radio ~3 ms; the rest is the chip.

**Where `nfc list`'s time goes** (`bench list`): the field cycle is 21 ms (the PN532 takes 6.3 ms to switch the field
off, 1.5 ms to switch it on, plus 5 ms off and 5 ms on), and listing up to two chips takes 42.6 ms against 29.1 ms for
one (the PN532 waits for a second chip). The ~35 ms was an empty reader.

**Stacks** (lowest free, bytes, after the whole bench): station loop 5588, nfc ~4030, oled ~2256, press ~1520–1860;
receiver loop 5860, press 2056–2328.

**P1's radio link is weaker.** Counting frames its radio sent but the receiver never acked: P1 loses about 6 a minute
idle and 25 in 40 taps, in bursts, with the motor off too; P2 loses none. The resends cover single losses (an extra
40 ms on an NFC reply); 3 of 320 P1 requests saw an outage longer than the 3 s deadline. Worth a look at where P1's
antenna sits.

### The speed-ups, measured

| Speed-up | Measured | Kept |
|---|---|---|
| The station selects the applet itself | Chip lands → applet ready at the Pi (40 taps): Pi selects 56.8 ms; station selects and puts the answer in the `tap` 52.0 ms, but the `tap` itself 52.0 ms instead of 28.9; station selects right after the `tap` and answers the Pi's SELECT from it 51.8 ms, `tap` still at 28.9 ms | Yes: right after the `tap` (not in it) |
| Try the AID the chip answered last first | These badges answer the legacy ID; the Arx ID costs a `6D00` after 23.4 ms. With the memory the station's select is 20 ms instead of 43 | Yes |
| The UID before the wake-up step | A list without the PN532's RATS gives the UID after 22.2 ms against 29.0 with it (6.8 ms sooner). But the chip is then not activated for the PN532's own ISO-DEP handling: RATS by hand takes 9.2 ms, and a second list by UID without a field cycle finds nothing, so every APDU would need an ISO-DEP layer on the station, and a chip command would be ≥ 2.4 ms later | No |
| Presence by R(NAK) alone (not Diagnose first) | Diagnose fails on these badges (status 0x13), and sent to a chip nothing has talked to it leaves the chip deaf to R(NAK) too: every check then fell back to a field cycle and a re-read, ~68 ms each (146 in 10 s). R(NAK) alone answers from the first check: 4.3 ms, 425 in 10 s, no misses. The 800 ms grace for a fresh chip existed only because of Diagnose, so it went too | Yes |
