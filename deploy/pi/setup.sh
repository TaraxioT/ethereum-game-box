#!/usr/bin/env bash
# One-time, idempotent setup of a Raspberry Pi 5 as the Box. Run it on the Pi as the Box's user (pi), which must be
# able to sudo, from any tree that holds deploy/pi (the repo, or a copy of just that folder):
#   [NODE_MAJOR=26] deploy/pi/setup.sh [--boot]
# What it does, and what it leaves alone:
# - apt: uhubctl and the tools the deploy scripts use, only the ones that are missing (nothing is upgraded), and rtkit
# - Node.js NODE_MAJOR (default 26) from the official tarball into ~/.local, ahead of the system's Node on PATH;
#   pnpm through corepack, at the version the repo pins
# - the user in dialout (the receiver's serial port), plugdev (USB hubs for uhubctl) and pipewire (realtime audio)
# - a udev rule that names the receiver /dev/egb-receiver by its USB id, and one that gives plugdev the USB hubs
# - the nice and realtime limits the server (Nice=-5, see egb-server.service) and PipeWire's audio threads need
# - ~/.config/egb/env from env.example, only if it does not exist yet (never overwritten)
# - loginctl linger, so the user's units run from boot with nobody logged in
# - a read-only ssh deploy key (~/.ssh/egb_deploy) for the updater, if there is none; the public half is printed
# - the egb-* systemd user units and the deploy scripts in ~/egb/bin. Nothing is enabled or started, except with --boot
#   (egb-server and egb-kiosk start at boot). The updater's timer stays off until the repo accepts the deploy key.
# It sets no sink, volume or Bluetooth setting.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=SCRIPTDIR/lib.sh
. "$here/lib.sh"

boot=0
[ "${1:-}" != --boot ] || boot=1
[ "$(id -u)" != 0 ] || die "run this as the Box's user (pi), not root; it uses sudo where it must"
node_major=${NODE_MAJOR:-26}
user=$(id -un)
need_relogin=0

# --- apt ------------------------------------------------------------------------------------------------------------
# Fonts: game covers and tiles use emoji, and Raspberry Pi OS ships without a colour emoji font.
# rtkit: Chromium's audio threads ask it for realtime priority (PipeWire gets its own from the pipewire group, below).
missing=()
for pkg in uhubctl curl rsync git xz-utils ca-certificates fonts-noto-color-emoji chromium rtkit; do
  dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ ${#missing[@]} -gt 0 ]; then
  log "apt: installing ${missing[*]}"
  sudo apt-get update -q
  sudo apt-get install -y -q "${missing[@]}"
fi

# --- Node -----------------------------------------------------------------------------------------------------------
case $(uname -m) in
  aarch64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) die "no Node.js tarball for $(uname -m)" ;;
esac
have_major=$("$HOME/.local/bin/node" --version 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/' || true)
if [ "$have_major" != "$node_major" ]; then
  base="https://nodejs.org/dist/latest-v$node_major.x"
  log "node: looking up the latest v$node_major in $base"
  sums_line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E " node-v[0-9.]+-linux-$node_arch\.tar\.xz\$") ||
    die "no Node.js $node_major tarball for $node_arch at $base"
  tarball=${sums_line##* }
  want_sum=${sums_line%% *}
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  log "node: downloading $tarball"
  curl -fsSL -o "$work/$tarball" "$base/$tarball"
  [ "$(sha256sum "$work/$tarball" | cut -d ' ' -f 1)" = "$want_sum" ] || die "$tarball does not match its published checksum"
  mkdir -p "$HOME/.local/lib/nodejs" "$HOME/.local/bin"
  tar -xJf "$work/$tarball" -C "$HOME/.local/lib/nodejs"
  node_home="$HOME/.local/lib/nodejs/${tarball%.tar.xz}"
  for bin in node npm npx; do ln -sfn "$node_home/bin/$bin" "$HOME/.local/bin/$bin"; done
fi
log "node: $(node --version) at $(command -v node)"
[ "$(node --version | sed -E 's/^v([0-9]+)\..*/\1/')" = "$node_major" ] || die "PATH finds a different node first: $(command -v node)"

# --- pnpm, through corepack ------------------------------------------------------------------------------------------
# Node 25 and later no longer ship corepack, so it is installed beside node (not borrowed from the system's Node).
[ -x "$HOME/.local/bin/corepack" ] || npm install -g --prefix "$HOME/.local" corepack
corepack enable --install-directory "$HOME/.local/bin" pnpm
# Fetch the pinned pnpm now, so the first build doesn't have to. Needs the repo's package.json next to deploy/pi.
if [ -f "$here/../../package.json" ]; then
  (cd "$here/../.." && corepack install)
  log "pnpm: $(cd "$here/../.." && pnpm --version)"
fi

# --- groups, udev -----------------------------------------------------------------------------------------------------
for group in dialout plugdev pipewire; do
  if ! id -nG | tr ' ' '\n' | grep -qx "$group"; then
    log "adding $user to $group"
    sudo usermod -aG "$group" "$user"
    need_relogin=1
  fi
done

# A file for /etc, installed only when it differs (so a rerun doesn't reload udev for nothing).
sudo_install() { # source destination
  if ! sudo cmp -s "$1" "$2"; then
    sudo install -m 644 "$1" "$2"
    return 0
  fi
  return 1
}
if sudo_install "$here/egb-receiver.rules" /etc/udev/rules.d/70-egb-receiver.rules || [ ! -e /dev/egb-receiver ]; then
  sudo udevadm control --reload-rules
  sudo udevadm trigger --action=change --subsystem-match=tty --subsystem-match=usb
  sudo udevadm settle --timeout=10
fi
if [ -e /dev/egb-receiver ]; then
  log "udev: /dev/egb-receiver -> $(readlink -f /dev/egb-receiver)"
else
  log "udev: /dev/egb-receiver is not there yet; it appears when the receiver (ESP32-C3, serial 7C:DF:A1:D5:04:CC) is plugged in"
fi

# --- nice and realtime ------------------------------------------------------------------------------------------------
# Two units need raised limits. egb-server runs at Nice=-5. PipeWire's audio threads need realtime priority, or they run
# as ordinary threads below the server and the speaker crackles whenever the Box is busy: its limits.d file grants the
# pipewire group rtprio 95, but PipeWire takes realtime only when it may also renice itself to -11 (else it falls back
# to xdg-desktop-portal, which fails on this Pi: "Could not get pidns"). A user's own line beats a group's, so ours says
# -11. RLIMIT_NICE 31 means "may lower nice down to -11" (20 minus the lowest nice). limits.d is read by the user
# manager's PAM session, so it holds from the next start of that manager; prlimit applies it to the running one now,
# which is what lets the very next restart of egb-server or pipewire take it up.
nice_conf=$(mktemp)
printf '%s - nice -11\n' "$user" >"$nice_conf"
sudo_install "$nice_conf" /etc/security/limits.d/60-egb-nice.conf || true
rm -f "$nice_conf"
limit() { awk -v name="Max $2 priority" 'index($0, name) == 1 {print $4}' "/proc/$1/limits"; } # pid nice|realtime
manager_pid=$(systemctl show -p MainPID --value "user@$(id -u).service" 2>/dev/null || echo 0)
if [ "${manager_pid:-0}" -gt 0 ]; then
  [ "$(limit "$manager_pid" nice)" = 31 ] || sudo prlimit --pid "$manager_pid" --nice=31:31
  [ "$(limit "$manager_pid" realtime)" = 95 ] || sudo prlimit --pid "$manager_pid" --rtprio=95:95
  [ "$(limit "$manager_pid" nice)" = 31 ] ||
    die "could not raise the nice limit of the user manager (pid $manager_pid): egb-server's Nice=-5 would fail"
  log "nice: the user manager may run units down to nice -11, and give PipeWire realtime priority"
else
  log "nice: no user manager is running; the limits apply when it starts"
fi

# --- settings, data, linger --------------------------------------------------------------------------------------------
mkdir -p "$(dirname "$EGB_ENV_FILE")" "$HOME/.local/share/egb"
if [ ! -f "$EGB_ENV_FILE" ]; then
  install -m 600 "$here/env.example" "$EGB_ENV_FILE"
  log "created $EGB_ENV_FILE from env.example: add the API keys there"
fi
chmod 600 "$EGB_ENV_FILE"

if [ "$(loginctl show-user "$user" -p Linger --value 2>/dev/null || echo no)" != yes ]; then
  sudo loginctl enable-linger "$user"
  log "linger: on"
fi

# --- the updater's deploy key ----------------------------------------------------------------------------------------
key="$HOME/.ssh/egb_deploy"
if [ ! -f "$key" ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  ssh-keygen -q -t ed25519 -N '' -C "egb-pi-deploy" -f "$key"
  log "created the deploy key $key"
fi

# --- units and scripts -----------------------------------------------------------------------------------------------
install_scripts "$here"
install_units "$here"
systemctl --user daemon-reload
if [ "$boot" = 1 ]; then
  systemctl --user enable egb-server.service egb-kiosk.service
  log "egb-server and egb-kiosk start at boot"
fi

cat >&2 <<DONE

Setup done.
- Settings: $EGB_ENV_FILE
- Deploy key (read-only) for the repo, public half:
$(cat "$key.pub")
- Then: deploy/pi/push.sh from the laptop. The updater (systemctl --user enable --now egb-update.timer) waits for the
  repo to accept that key and EGB_REPO_URL to be set.
DONE
if [ "$need_relogin" = 1 ]; then
  echo "- $user was added to a group: log out and in (or reboot) before the server uses the serial port." >&2
fi
