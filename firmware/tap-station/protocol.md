# The receiver's serial protocol

The one spec for the line between the receiver (the ESP32-C3 on the Pi's USB) and the Box server. The firmware
writes these lines, the server parses them, and the TypeScript tests use the example lines below verbatim, so a
change here is a change on both sides.

## The line

- USB CDC serial (the baud rate is ignored; tools open it at 115200).
- One message per line, ending in `\n`. Lines from the Pi may end in `\r\n`; the `\r` is ignored.
- **Pi → receiver:** plain words separated by single spaces, at most 640 bytes.
- **Receiver → Pi:** one JSON object, at most 1024 bytes, written whole or not at all (the receiver never waits on
  USB: a line that doesn't fit the transmit buffer is dropped and counted in `stats`).
- `st` names a station by the last three bytes of its MAC, lower-case hex (`e4ba70`). Up to four stations share one
  receiver.
- `at_us` is the receiver's `micros()` when the event happened on the receiver (a 32-bit counter: it wraps every
  ~71 minutes, so the Pi compares it modulo 2³²).
- Every `id` a command carries is the caller's, a decimal from 1 to 2³²−1, and comes back on every line about that
  command. The receiver's own ids (taps, presses) are its own counters.
- Hex is upper or lower case on the way in, upper case on the way out.
- A field the Pi doesn't know is ignored, so new fields need no server change.

## Commands (Pi → receiver)

| Command | Does | Answered by |
|---|---|---|
| `state` | Reports every station it knows. Send it after opening the port. | `state` |
| `press <id>` | The same as the receiver's BOOT: toggles the first linked station's LED. | `c3_press`, then `c3_ack` or `c3_fail` |
| `buzz <st\|all> <id> [ms] [pulses]` | Runs a station's motor `pulses` times (1–3, default 1) for `ms` each (1–2000, default 80), 60 ms apart. | `buzz_ok` or `buzz_fail`, per station |
| `screen <st\|all> <id> <hex>` | Puts text on a station's OLED: the hex of up to 200 bytes of `key=value` lines (below). A newer screen for a station replaces one still being resent. | `screen_ok` or `screen_fail`, per station |
| `nfc <st> <id> apdu <hex>` | Sends an APDU (up to 255 bytes) to the chip on that station's reader. | `nfc_res` or `nfc_fail` |
| `nfc <st> <id> sign <hex>` | The same, for an APDU that makes the chip sign: the station shows `HOLD STILL` while it runs and reports `signed` after. | `nfc_res` (and `signed`) or `nfc_fail` |
| `nfc <st> <id> reselect` | Re-activates the chip on the reader (RF field cycle unless nothing has talked to it since it landed) and reselects the HaLo applet. | `nfc_res` with `tags` and `sel` |
| `nfc <st> <id> select <uid>` | Activates that chip by UID. | `nfc_res` with `tags` |
| `nfc <st> <id> list` | Lists the chips on the reader. | `nfc_res` with `tags` |
| `stats [st]` | Reports stack high-water marks and counters, of the receiver (no `st`) or of a station. | `stats` |

One NFC request is in flight per station: a new one replaces the one in flight. The receiver resends it every 40 ms
until the station's reply (3 s at most); the station runs each id once, ignores resends while it works, and answers
a resend of the one it just finished with the same reply.

A command the receiver can't parse is answered with `bad`. Every command produces at least one line, including the
first one after the receiver starts.

Examples:

```
state
press 7
buzz e4ba70 3 80
buzz df3d88 4 60 2
screen e4ba70 6 7461673d50310a6269673d5441500a736d616c6c3d4e4f5641
nfc e4ba70 12 apdu 00A4040007481199130E9F0100
nfc e4ba70 13 reselect
nfc df3d88 14 list
stats
stats e4ba70
```

## Events (receiver → Pi)

### The receiver and the links

```
{"ev":"ready","mac":"7CDFA1D504CC","fw":"1.0.0"}
{"ev":"state","stations":[{"st":"e4ba70","up":true,"nfc":true,"uid":"04A1B2C3D4E5F6","rssi":-41},{"st":"df3d88","up":false,"nfc":false,"uid":null,"rssi":0}]}
{"ev":"link","st":"e4ba70","up":true}
{"ev":"link","st":"e4ba70","up":false}
{"ev":"ping","st":"e4ba70","rtt_us":2760,"rssi":-37,"nfc":true,"s3_led":0,"c3_led":1}
{"ev":"nfc","st":"e4ba70","ok":false}
{"ev":"bad","why":"unknown command","line":"bogus 1"}
```

- `ready` once at boot, and again in answer to nothing else.
- `link` `up:true` on a station's first packet; `up:false` after 2.5 s without any packet from it (every packet
  counts, not only pings).
- `ping` on every station ping (four a second): its last ping round trip, the signal, the reader's state and both
  LEDs.
- `nfc` when a station's PN532 starts or stops answering.

### Chips

```
{"ev":"tap","st":"e4ba70","id":5,"uid":"04A1B2C3D4E5F6","atqa":"0044","sak":"20","ats":"78807002","read_us":27400,"gap_us":20500,"tries":1,"at_us":4012345678}
{"ev":"gone","st":"e4ba70","id":5,"uid":"04A1B2C3D4E5F6","at_us":4013345678}
{"ev":"signed","st":"e4ba70","id":12,"tap":5,"uid":"04A1B2C3D4E5F6","ok":true,"chip_us":402000,"total_us":560000,"at_us":4013000000}
```

- `tap` the moment the PN532 reads a chip, while the motor is already running. ISO-DEP chips (HaLos) come activated,
  with their ATS.
  - `read_us`: the station's µs from the start of the detection that found the chip until the packet left.
  - `gap_us`: how long the detection before it took. The chip landed in that window, so the Pi takes the touch as
    `at_us − radio − read_us − gap_us / 2`.
  - The station selects the HaLo applet itself right after an ISO-DEP chip's `tap` has gone out (the SELECT that
    chip answered last first) and keeps the chip's answer: the Pi's own SELECT with the same bytes (`nfc … apdu`),
    sent while nothing else has gone to the chip, is answered from it at once.
  - `tries`: radio sends until the receiver's ack.
- `gone` after two reads in a row without the chip.
- `signed` after every `sign` request: `chip_us` is that exchange on the reader alone, `total_us` the time since the
  chip was detected.

### Requests

```
{"ev":"buzz_ok","st":"e4ba70","id":3,"tries":1,"rtt_us":2900}
{"ev":"buzz_fail","st":"e4ba70","id":3,"why":"no ack"}
{"ev":"buzz_fail","st":"all","id":4,"why":"no such station linked"}
{"ev":"screen_ok","st":"e4ba70","id":6,"tries":1,"rtt_us":3100}
{"ev":"screen_fail","st":"e4ba70","id":6,"why":"no ack"}
{"ev":"screen_fail","st":"e4ba70","id":7,"why":"bad request"}
{"ev":"nfc_res","st":"e4ba70","id":12,"op":"apdu","ok":true,"err":0,"hex":"9000","us":21500,"wait_us":12900,"rtt_us":24800,"tries":1}
{"ev":"nfc_res","st":"e4ba70","id":13,"op":"reselect","ok":true,"err":0,"tags":[{"uid":"04A1B2C3D4E5F6","atqa":"0044","sak":"20","ats":"78807002"}],"sel":"9000","us":52000,"wait_us":44000,"rtt_us":56000,"tries":2}
{"ev":"nfc_res","st":"df3d88","id":14,"op":"list","ok":true,"err":0,"tags":[],"us":30500,"wait_us":24100,"rtt_us":34800,"tries":1}
{"ev":"nfc_res","st":"e4ba70","id":15,"op":"apdu","ok":false,"err":2,"pn532":1,"us":350000,"wait_us":349000,"rtt_us":355000,"tries":9}
{"ev":"nfc_fail","st":"e4ba70","id":16,"why":"no reply"}
{"ev":"nfc_fail","st":"0a0b0c","id":17,"why":"no such station linked"}
```

- `buzz_ok` / `screen_ok` when the station acked; `rtt_us` is from the first send to the ack. `buzz_fail` /
  `screen_fail` after a second without one, or at once with `bad request` or `no such station linked`. `all` gets
  one line per linked station (or one `buzz_fail` with `st` `all` when none is linked). A screen replaced by a newer
  one before its ack gets neither line.
- `nfc_res` answers an `nfc` request. `us` is the station's time on it, `wait_us` the part spent waiting for the
  PN532 and the chip (the rest is the S3's I²C), `rtt_us` the receiver's whole round trip. `apdu` and `sign` answers
  carry `hex`; `reselect`, `select` and `list` answers carry `tags`. `ok:false` comes with `err`:

  | `err` | Meaning |
  |:-:|---|
  | 1 | no chip answered |
  | 2 | RF error (`pn532` = the PN532's status byte; 255 = the PN532 itself timed out) |
  | 3 | an APDU with no chip on the reader |
  | 4 | the PN532 isn't answering |
  | 5 | a bad request |

- `nfc_fail` when no reply came within 3 s (`no reply`), or nothing went out (`no such station linked`,
  `bad request`).

### Presses and buttons

```
{"ev":"c3_press","id":7,"at_us":4012345000}
{"ev":"c3_ack","st":"e4ba70","id":7,"rtt_us":2390,"tries":1,"s3_led":1}
{"ev":"c3_fail","id":7,"tries":25}
{"ev":"s3_press","st":"e4ba70","id":9,"tries":1,"c3_led":1,"at_us":4012346000}
{"ev":"s3_report","st":"e4ba70","id":9,"rtt_us":2780,"tries":1}
{"ev":"button","board":"s3","st":"e4ba70","down":true}
{"ev":"button","board":"c3","down":false}
```

- `c3_press` when the receiver's BOOT goes down or a `press` arrives (with the caller's id), then `c3_ack` when the
  station switched its LED and acked, or `c3_fail` after 25 sends.
- `s3_press` when a station's BOOT switched the receiver's LED; `s3_report` follows with the station's own round
  trip.
- `button` when either board's BOOT goes down or comes up.

### Stats

```
{"ev":"stats","board":"c3","stack":{"loop":2210,"press":1420},"dropped":0,"send_fails":0,"up_ms":360000}
{"ev":"stats","board":"s3","st":"e4ba70","stack":{"loop":3100,"nfc":2900,"oled":1800,"press":1500},"dropped":0,"send_fails":0,"up_ms":358000}
```

`stack` is each task's lowest free stack in bytes since boot. `dropped` counts serial lines dropped for want of room
in the transmit buffer.

## Screens

A `screen` payload is up to 200 bytes of printable ASCII: `key=value` lines separated by `\n`. Unknown keys and
lines without `=` are skipped; anything outside printable ASCII shows as `?`. Each payload replaces the last one
whole (a key left out goes back to its default).

| Key | Shows | Default |
|---|---|---|
| `tag` | up to 3 characters in the top-left badge (`P1`, `P2`); empty = none | none |
| `big` | the idle big line, up to 10 characters, upper-cased (`TAP`, `WAIT`, `SIGN`, `WIN`); empty = none | `TAP` |
| `small` | the idle small line, up to 20 characters as given (a player name, `10 EGB`, `to join`) | none |
| `hold` | `BIG\|small` while the chip is held and the app reads it (no `\|`: no small line) | `HOLD\|reading` |
| `sign` | the same while a `sign` request runs | `HOLD STILL\|signing` |
| `done` | read done, or signature back | `DONE` |
| `fail` | sign failed, or lifted mid-sign | `AGAIN\|tap again` (lifted: `TOO SOON\|tap again`) |
| `ttl` | seconds the screen stays without being sent again; 0 or none = until the link drops | 0 |

The station drops the Pi's screen (back to every default) when its `ttl` runs out or 3 s after the link drops; it
doesn't come back with the link, so the Pi sends it again on relink. The Box sends each station's screen on change,
on relink, and every 5 s with `ttl=15`.

Example: `tag=P1\nbig=TAP\nsmall=NOVA` is `7461673d50310a6269673d5441500a736d616c6c3d4e4f5641`.

## The station's own serial port

Each station also answers on its own USB port, for bring-up and screenshots: `press`, `buzz [ms]`, `stats`,
`bench <what> [n]` (timing runs on the chip on the reader), and `frame`, which prints the OLED as `frame 72 40 <hex>`
(row-major, one bit a pixel, most significant bit first; read by `tools/frame.py`). It prints `tag uid=… read_us=…`
and `tag gone` as chips come and go.
