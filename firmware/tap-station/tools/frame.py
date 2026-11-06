#!/usr/bin/env python3
"""Screenshot a tap station's OLED as a PNG, over the station's own USB serial.

    python3 frame.py <port> <out.png> [--scale 8] [--count N]

Sends `frame` and draws the `frame 72 40 <hex>` line it answers (row-major, one bit a pixel, most significant bit
first) scaled up, blue-white on black like the panel. With --count N it takes N frames a quarter second apart
(out-1.png, out-2.png...). Needs pyserial and nothing else (the PNG is written by hand).

The port opens without touching DTR or RTS beyond what opening does (both asserted together), which leaves the S3
running: setting them one at a time can reset it. A lone newline goes first, to end any partial line a freshly
plugged-in port echoed back to the station.
"""

import argparse
import struct
import sys
import time
import zlib

import serial

ON, OFF = (120, 200, 255), (8, 10, 14)


def grab(port: serial.Serial) -> tuple[int, int, bytes]:
    port.reset_input_buffer()
    port.write(b"\nframe\n")
    deadline = time.time() + 2
    buf = b""
    while time.time() < deadline:
        buf += port.read(port.in_waiting or 1)
        for line in buf.split(b"\n")[:-1]:  # whole lines only
            if line.startswith(b"frame "):
                parts = line.decode().split()
                if len(parts) == 4:
                    w, h = int(parts[1]), int(parts[2])
                    data = bytes.fromhex(parts[3])
                    if len(data) == w * h // 8:
                        return w, h, data
    raise SystemExit("no frame from the station")


def png(path: str, w: int, h: int, bits: bytes, scale: int) -> None:
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            on = bits[(y * w + x) // 8] >> (7 - (x % 8)) & 1
            row += bytes(ON if on else OFF) * scale
        rows += [b"\x00" + bytes(row)] * scale
    raw = b"".join(rows)

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    header = struct.pack(">IIBBBBB", w * scale, h * scale, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("port", help="the station's serial port, e.g. /dev/serial/by-id/usb-Espressif_..._DC:54:75:E4:BA:70-if00")
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=8)
    ap.add_argument("--count", type=int, default=1)
    args = ap.parse_args()
    with serial.Serial(args.port, 115200, timeout=0.2) as port:
        for i in range(args.count):
            path = args.out if args.count == 1 else args.out.replace(".png", f"-{i + 1}.png")
            png(path, *grab(port), args.scale)
            print(path)
            if i + 1 < args.count:
                time.sleep(0.25)


if __name__ == "__main__":
    sys.exit(main())
