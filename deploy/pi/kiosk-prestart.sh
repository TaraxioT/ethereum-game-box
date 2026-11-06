#!/bin/sh
# Runs before the kiosk browser starts (ExecStartPre of egb-kiosk.service). Three things, each a trap met on the Pi:
# 1. The screen's server must answer first: a page that loads before the server is up shows an error and stays there.
# 2. The compositor's socket must exist. At boot the user manager starts before labwc has logged in; without this
#    Chromium dies at once and systemd's restarts burn through their budget before the desktop is there.
# 3. An earlier Chromium on this profile must be gone, and the window placement it saved must be forgotten. A second
#    Chromium on a profile hands its window to the first one, which opens it as a normal window; and a saved
#    placement (seen: 1050x700) can win over the full-screen flags after a redeploy.
set -eu
profile="$HOME/.config/egb-chromium"
socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/${WAYLAND_DISPLAY:-wayland-0}"

i=0
until curl -sf -m 2 http://127.0.0.1:8790/api/health >/dev/null; do
  i=$((i + 1))
  [ "$i" -lt 120 ] || { echo "the Box server does not answer on 8790" >&2; exit 1; }
  sleep 1
done

i=0
until [ -S "$socket" ]; do
  i=$((i + 1))
  [ "$i" -lt 120 ] || { echo "no Wayland socket at $socket" >&2; exit 1; }
  sleep 1
done

i=0
while pgrep -f "user-data-dir=$profile" >/dev/null && [ "$i" -lt 50 ]; do
  i=$((i + 1))
  sleep 0.2
done

# A profile that does not exist yet, or one that cannot be read, has nothing to forget.
node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const prefs = JSON.parse(fs.readFileSync(file, "utf8"));
  if (prefs.browser) delete prefs.browser.app_window_placement;
  fs.writeFileSync(file, JSON.stringify(prefs));
} catch {}
' "$profile/Default/Preferences"
