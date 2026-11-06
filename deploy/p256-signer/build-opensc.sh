#!/bin/bash
# Builds the patched OpenSC the HyperSecu HYP2003 token needs, into /opt/gbx-opensc (never touches the system OpenSC).
#   deploy/p256-signer/build-opensc.sh [--force] [--remove-build-deps]
# Idempotent: when /opt/gbx-opensc already holds this commit with this patch it only re-checks the profile tweak.
#   --force               rebuild even if the stamp matches
#   --remove-build-deps   afterwards apt-remove the build packages this run installed (ones that were already there stay)
# Reproducible: pinned to one OpenSC commit plus opensc-epass2003-hyp2003.patch (next to this script).
# Needs sudo (apt, and writing /opt). Takes a few minutes on a Pi 5.
set -euo pipefail

OPENSC_URL=${OPENSC_URL:-https://github.com/OpenSC/OpenSC}
OPENSC_COMMIT=3856d69
PREFIX=/opt/gbx-opensc
HERE=$(cd "$(dirname "$0")" && pwd)
PATCH=$HERE/opensc-epass2003-hyp2003.patch
DEPS=(build-essential autoconf autoconf-archive automake libtool pkg-config git gengetopt
      libpcsclite-dev libssl-dev zlib1g-dev libreadline-dev)

force=0 remove_deps=0
for a in "$@"; do
  case $a in
    --force) force=1 ;;
    --remove-build-deps) remove_deps=1 ;;
    *) echo "usage: $0 [--force] [--remove-build-deps]" >&2; exit 2 ;;
  esac
done

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO=sudo
[ -f "$PATCH" ] || { echo "missing $PATCH" >&2; exit 1; }
patch_sum=$(sha256sum "$PATCH" | cut -d' ' -f1)
stamp="$OPENSC_COMMIT $patch_sum"
PROFILE=$PREFIX/share/opensc/epass2003.profile

# The token holds its key without a usable PIN gate (see README), so new PKCS#15 files must not require the PIN:
# in the `onepin` option, `protected` becomes *=NEVER,READ=NONE, UPDATE=NONE, DELETE=NONE. Idempotent; .orig kept once.
tweak_profile() {
  [ -f "$PROFILE" ] || { echo "no $PROFILE" >&2; exit 1; }
  [ -f "$PROFILE.orig" ] || $SUDO cp -p "$PROFILE" "$PROFILE.orig"
  local tmp; tmp=$(mktemp)
  python3 - "$PROFILE" "$tmp" <<'PY'
import re, sys
src, dst = sys.argv[1:3]
text = open(src).read()
m = re.search(r"^option onepin \{.*?^\}", text, re.S | re.M)
if not m:
    sys.exit("option onepin not found in " + src)
block = m.group(0)
new, n = re.subn(r"^(\s*protected\s*=\s*)[^;\n]*;[^\n]*$",
                 r"\1*=NEVER,READ=NONE, UPDATE=NONE, DELETE=NONE; # gbx test: no PIN on PKCS#15 files", block, count=1, flags=re.M)
if n != 1:
    sys.exit("no `protected` line in the onepin option")
open(dst, "w").write(text[:m.start()] + new + text[m.end():])
PY
  if cmp -s "$tmp" "$PROFILE"; then echo "profile tweak already applied"; else $SUDO install -m 644 "$tmp" "$PROFILE"; echo "profile tweak applied"; fi
  rm -f "$tmp"
}

if [ "$force" = 0 ] && [ -f "$PREFIX/.build-stamp" ] && [ "$(cat "$PREFIX/.build-stamp")" = "$stamp" ] && [ -f "$PREFIX/lib/opensc-pkcs11.so" ]; then
  echo "OpenSC $OPENSC_COMMIT + patch already built in $PREFIX"
  tweak_profile
  exit 0
fi

# Build dependencies: remember which ones this run installs so --remove-build-deps only removes those.
missing=()
for p in "${DEPS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "installing build dependencies: ${missing[*]}"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y --no-install-recommends "${missing[@]}"
fi

work=$(mktemp -d)
cleanup() {
  rm -rf "$work"
  if [ "$remove_deps" = 1 ] && [ ${#missing[@]} -gt 0 ]; then
    echo "removing the build dependencies this run installed: ${missing[*]}"
    $SUDO apt-get remove -y "${missing[@]}" || true
  fi
}
trap cleanup EXIT

echo "cloning OpenSC $OPENSC_COMMIT"
git clone -q "$OPENSC_URL" "$work/OpenSC"
cd "$work/OpenSC"
git checkout -q "$OPENSC_COMMIT"
git apply --check "$PATCH"
git apply "$PATCH"

./bootstrap
./configure --prefix="$PREFIX" --sysconfdir="$PREFIX/etc" \
  --disable-doc --disable-man --disable-tests --disable-notify --disable-cmocka
make -j"$(nproc)"
$SUDO make install
echo "$stamp" | $SUDO tee "$PREFIX/.build-stamp" >/dev/null

tweak_profile
echo "done: $PREFIX/lib/opensc-pkcs11.so"
