#!/bin/sh
# Flashes the boards on the Pi: copies the merged bins there and runs esptool on the Pi, by /dev/serial/by-id path.
# Refuses a board whose port something holds (the Box server, a monitor): stop it first.
#   pnpm firmware:flash [receiver|df3b9c|df3d88|all]     (default all; run pnpm firmware:build first)
# Stations are named by their id, not a seat: seats go by link order. A station on a laptop's USB (e4ba70) is flashed
# there: esptool --chip esp32s3 --port <its port> write-flash 0x0 build/station/station.ino.merged.bin
#   EGB_PI=host         the Pi's ssh name (default pi)
set -eu
cd "$(dirname "$0")/.."
pi=${EGB_PI:-pi}
target=${1:-all}
by_id=/dev/serial/by-id/usb-Espressif_USB_JTAG_serial_debug_unit_
receiver="receiver esp32c3 ${by_id}7C:DF:A1:D5:04:CC-if00"
df3b9c="station esp32s3 ${by_id}DC:54:75:DF:3B:9C-if00"
df3d88="station esp32s3 ${by_id}DC:54:75:DF:3D:88-if00"
case "$target" in
  receiver) boards="$receiver" ;;
  df3b9c) boards="$df3b9c" ;;
  df3d88) boards="$df3d88" ;;
  all) boards="$receiver
$df3b9c
$df3d88" ;;
  *) echo "usage: flash.sh [receiver|df3b9c|df3d88|all]" >&2; exit 2 ;;
esac
for sketch in receiver station; do
  if echo "$boards" | grep -q "^$sketch " && [ ! -f "build/$sketch/$sketch.ino.merged.bin" ]; then
    echo "no build/$sketch: run pnpm firmware:build" >&2
    exit 1
  fi
done
ssh "$pi" mkdir -p egb-firmware
echo "$boards" | while read -r sketch _ _; do
  scp -q "build/$sketch/$sketch.ino.merged.bin" "$pi:egb-firmware/$sketch.bin"
done
# Each board in turn, on the Pi: nothing may hold its port while esptool resets it into the bootloader.
echo "$boards" | ssh "$pi" sh -c "'
  set -eu
  while read -r sketch chip port; do
    [ -e \"\$port\" ] || { echo \"\$port: not plugged in\" >&2; exit 1; }
    if fuser \"\$port\" >/dev/null 2>&1; then
      echo \"\$port is in use (\$(fuser \"\$port\" 2>&1)): stop whatever holds it\" >&2
      exit 1
    fi
    echo \"== \$sketch on \$port\"
    ~/.local/bin/esptool --chip \$chip --port \"\$port\" -b 921600 write-flash 0x0 egb-firmware/\$sketch.bin | tail -3
  done
'"
