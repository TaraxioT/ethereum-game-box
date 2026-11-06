#!/bin/sh
# Host tests: the firmware's plain C++ (packets, resend timing on a fake clock, the JSON writer, hex, the line reader,
# the Pi's commands and lines, PN532 frames, the screen parser, the LED/OLED table and the font fit), built with the
# host compiler, no Arduino. The font tests draw with U8g2's own C library (the installed Arduino library), with
# just the fonts the station uses cut out of its 40 MB font file.
set -eu
cd "$(dirname "$0")/.."
out=build/test
mkdir -p "$out/u8g2"
CXX=${CXX:-$(command -v clang++ || command -v g++)}
CC=${CC:-$(command -v clang || command -v gcc)}

u8g2=""
for dir in "$(arduino-cli config get directories.user 2>/dev/null || true)" "$HOME/Documents/Arduino" "$HOME/Arduino"; do
  if [ -n "$dir" ] && [ -f "$dir/libraries/U8g2/src/clib/u8g2.h" ]; then
    u8g2="$dir/libraries/U8g2/src"
    break
  fi
done
[ -n "$u8g2" ] || { echo "U8g2 not found: arduino-cli lib install U8g2" >&2; exit 1; }

# U8g2's C library, built once.
if [ ! -f "$out/u8g2/lib.a" ]; then
  for f in "$u8g2"/clib/u8g2_*.c "$u8g2"/clib/u8x8_*.c; do
    case "$f" in */u8g2_fonts.c) continue ;; esac
    "$CC" -O1 -w -c -I"$u8g2/clib" "$f" -o "$out/u8g2/$(basename "$f" .c).o"
  done
  # The fonts screen_draw.h names, cut out of u8g2_fonts.c.
  fonts=$(grep -oE 'u8g2_font_[A-Za-z0-9_]+' station/screen_draw.h | sort -u)
  {
    echo '#include "u8g2.h"'
    for font in $fonts; do
      LC_ALL=C awk -v name="$font" '
        index($0, "const uint8_t " name "[") == 1 { on = 1 }
        on { print; if ($0 ~ /;[ \t]*$/) exit }' "$u8g2/clib/u8g2_fonts.c"
    done
  } > "$out/u8g2/fonts.c"
  "$CC" -O1 -w -c -I"$u8g2/clib" "$out/u8g2/fonts.c" -o "$out/u8g2/fonts.o"
  ar rcs "$out/u8g2/lib.a" "$out"/u8g2/*.o
fi

# shellcheck disable=SC2046
"$CXX" -std=c++17 -O1 -g -Wall -Wextra -Werror -Wno-missing-field-initializers \
  -I lib/EgbLink/src -I station -I receiver -I test -I "$u8g2" \
  -DPROTOCOL_MD="\"$(pwd)/protocol.md\"" \
  test/*.cpp "$out/u8g2/lib.a" -o "$out/tests"
"$out/tests"
