#!/bin/sh
# Compiles both sketches with every warning on, into firmware/tap-station/build/<sketch>/ (merged bins included).
#   pnpm firmware:build            both
#   pnpm firmware:build station    one
set -eu
cd "$(dirname "$0")/.."
extra=""
# Arduino's bundled ctags is Intel-only; on Apple Silicon use Homebrew's universal-ctags (brew install universal-ctags).
# Safe because each .ino is a stub: it declares nothing for ctags to index.
if [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ]; then
  extra="--build-property tools.ctags.path=/opt/homebrew/bin"
fi
for sketch in ${1:-receiver station}; do
  case "$sketch" in
    station) fqbn="esp32:esp32:esp32s3:CDCOnBoot=cdc" ;;
    # At the default 80 MHz the C3's flash reads back garbage once the bootloader speeds it up.
    receiver) fqbn="esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashFreq=40,FlashMode=dio" ;;
    *) echo "usage: build.sh [receiver|station]" >&2; exit 2 ;;
  esac
  echo "== $sketch ($fqbn)"
  # shellcheck disable=SC2086
  arduino-cli compile --no-color --fqbn "$fqbn" --warnings all --libraries lib $extra --output-dir "build/$sketch" "$sketch" \
    2>&1 | tee "build/$sketch.log" | grep -vE '^(Sketch uses|Global variables|Used (library|platform)|EgbLink|U8g2|Wire|WiFi|Networking|esp32 )' || true
  if grep -qE 'warning:|error:' "build/$sketch.log"; then
    echo "$sketch: warnings or errors (build/$sketch.log)" >&2
    exit 1
  fi
  [ -f "build/$sketch/$sketch.ino.merged.bin" ] || { echo "$sketch: no merged bin" >&2; exit 1; }
  rm -rf "$sketch/build"  # the esp32 core also copies its build files into the sketch folder
  grep -E '^(Sketch uses|Global variables)' "build/$sketch.log"
done
