#!/usr/bin/env bash
# Shared by the Pi deploy scripts: source it, don't run it. Layout on the Pi:
#   ~/egb/repo/              bare mirror of the Git remote (the updater fetches it with a read-only deploy key)
#   ~/egb/incoming/<commit>/ a source tree pushed from a laptop (push.sh), removed once it is built
#   ~/egb/releases/<name>/   one built tree per deploy: <commit>-<stamp>, with node_modules, dist and RELEASE.json
#   ~/egb/current            symlink to the live release; the server unit runs from here
#   ~/egb/bin/               stable copies of the deploy scripts, refreshed on every good activation
#   ~/egb/state/             the updater's memory and deploy.log
#   ~/.config/egb/env        settings and secrets (mode 600), read by the units and by `setting` below
#   ~/.local/share/egb/      the Box's data (ledger, badges, games, sessions); never touched by a deploy
# shellcheck shell=bash disable=SC2034

EGB_HOME="$HOME/egb"
EGB_REPO="$EGB_HOME/repo"
EGB_INCOMING="$EGB_HOME/incoming"
EGB_RELEASES="$EGB_HOME/releases"
EGB_CURRENT="$EGB_HOME/current"
EGB_BIN="$EGB_HOME/bin"
EGB_STATE="$EGB_HOME/state"
EGB_ENV_FILE="${EGB_ENV_FILE:-$HOME/.config/egb/env}"
EGB_UNIT_DIR="$HOME/.config/systemd/user"
EGB_DEPLOY_LOG="$EGB_STATE/deploy.log"

# Node and pnpm live in ~/.local/bin (setup.sh puts them there), ahead of the system's own Node.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
# systemctl --user over ssh (a push, the updater's own unit) needs the runtime dir; linger keeps it alive.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
# pnpm comes from corepack; never let it stop to ask whether it may download.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

mkdir -p "$EGB_INCOMING" "$EGB_RELEASES" "$EGB_BIN" "$EGB_STATE"

log() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$EGB_DEPLOY_LOG" >&2
  # A log that grows forever fills a 32 GB card; keep the newest 2000 lines once it passes 1 MB.
  if [ "$(wc -c <"$EGB_DEPLOY_LOG")" -gt 1048576 ]; then
    tail -n 2000 "$EGB_DEPLOY_LOG" >"$EGB_DEPLOY_LOG.tmp" && mv -f "$EGB_DEPLOY_LOG.tmp" "$EGB_DEPLOY_LOG"
  fi
}

die() {
  log "error: $*"
  exit 1
}

# Hides credentials in URLs (https://token@host/...) before text reaches a log.
redact() { sed -E 's#(://)[^/@ ]+@#\1***@#g'; }

# Logs a message only when it differs from the last one under the same key. The updater runs every 30 s and an
# unchanged "no deploy key yet" must not fill the log.
log_once() { # key message
  local file="$EGB_STATE/said-$1"
  [ "$(cat "$file" 2>/dev/null || true)" = "$2" ] && return 0
  printf '%s' "$2" >"$file"
  log "$2"
}

# A setting: the environment first, then ~/.config/egb/env, then the default. The file is parsed, never sourced:
# it is a systemd EnvironmentFile (KEY=value, # comments, optional quotes), not a shell script.
setting() { # KEY [default]
  local key=$1 default=${2:-} value
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}"
    return 0
  fi
  value=$(sed -n "s/^[[:space:]]*$key=//p" "$EGB_ENV_FILE" 2>/dev/null | tail -n 1 || true)
  value=${value%\"}
  value=${value#\"}
  value=${value%\'}
  value=${value#\'}
  printf '%s' "${value:-$default}"
}

box_port() { setting EGB_PORT 8790; }

# One field of a release's RELEASE.json (empty when there is none).
release_field() { # release-dir field
  node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];if(v)console.log(v)}catch{}' \
    "$1/RELEASE.json" "$2"
}

# Sets one string field in a release's RELEASE.json, creating the file if needed.
release_set() { # release-dir field value
  node -e 'const fs=require("fs");const[f,k,v]=process.argv.slice(1);let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}j[k]=v;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' \
    "$1/RELEASE.json" "$2" "$3"
}

# The release `current` points at, or nothing.
current_release() { readlink -f "$EGB_CURRENT" 2>/dev/null || true; }

# Every release folder, newest first. The stamp at the end of the name is the build time.
releases_newest_first() {
  local dir
  for dir in "$EGB_RELEASES"/*/; do
    dir=${dir%/}
    [ -d "$dir" ] && printf '%s %s\n' "${dir##*-}" "$dir"
  done | sort -r | cut -d ' ' -f 2-
}

# The newest built release of a commit that has not failed to activate. RELEASE.json is written only after the smoke
# test passed, so a folder without one is not a release.
built_release_for() { # commit
  local dir
  while read -r dir; do
    case $(basename "$dir") in "${1:0:12}"-*) ;; *) continue ;; esac
    [ -f "$dir/RELEASE.json" ] || continue
    [ -z "$(release_field "$dir" failed)" ] || continue
    printf '%s\n' "$dir"
    return 0
  done < <(releases_newest_first)
  return 1
}

# True when GET /api/health answers {"ok":true}.
health_ok() { # port
  curl -sf -m 2 "http://127.0.0.1:$1/api/health" |
    node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.exit(JSON.parse(d).ok===true?0:1)}catch{process.exit(1)}})'
}

# Waits up to <seconds> for /api/health. With a pid it also gives up the moment that process is gone, and an answer
# only counts while it is alive (an unrelated server on the port must not pass).
wait_health() { # port seconds [pid]
  local port=$1 max=$2 pid=${3:-} i
  for ((i = 0; i < max; i++)); do
    if health_ok "$port" && { [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; }; then return 0; fi
    [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null || return 1
    sleep 1
  done
  return 1
}

# Prints why the Box is busy and returns 0, or returns 1 when it is idle. /api/state says busy:false only between
# matches; a Box that isn't running has nothing to interrupt. An answer that isn't readable counts as busy.
box_busy_reason() {
  local json
  json=$(curl -sf -m 3 "http://127.0.0.1:$(box_port)/api/state" 2>/dev/null) || return 1
  printf '%s' "$json" | node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  try {
    const s = JSON.parse(d);
    if (s.busy === false) process.exit(1);
    console.log("a match is on (" + (s.phase ?? "unknown phase") + ")");
  } catch {
    console.log("the state is unreadable");
  }
});'
}

# Waits until the Box is idle, at most <seconds> (default EGB_IDLE_WAIT, 900). Returns 1 on timeout.
wait_idle() { # [seconds]
  local max=${1:-$(setting EGB_IDLE_WAIT 900)} waited=0 why
  while why=$(box_busy_reason); do
    [ "$waited" -lt "$max" ] || { log "the Box is still busy after ${max}s: $why"; return 1; }
    [ $((waited % 60)) -eq 0 ] && log "waiting for an idle Box: $why"
    sleep 5
    waited=$((waited + 5))
  done
}

# One deploy at a time. A script that is called by one that already holds the lock (EGB_LOCK_HELD) goes straight on.
# --quiet exits 0 at once when somebody else holds it (the updater's next tick will try again); without it, waits.
lock_deploy() { # [--quiet]
  [ "${EGB_LOCK_HELD:-}" = 1 ] && return 0
  exec 9>"$EGB_HOME/deploy.lock"
  if ! flock -n 9; then
    [ "${1:-}" = --quiet ] && exit 0
    log "another deploy is running; waiting for it"
    flock -w "$(setting EGB_LOCK_WAIT 1800)" 9 || die "gave up waiting for the other deploy"
  fi
  export EGB_LOCK_HELD=1
}

# Runs a heavy command (an install, a build) behind everything else: a deploy in the middle of a match must not
# cost the tap path its CPU or the SD card its reads.
lowprio() {
  if command -v ionice >/dev/null 2>&1; then
    nice -n 15 ionice -c 3 "$@"
  else
    nice -n 15 "$@"
  fi
}

# Copies the egb-* units of a deploy/pi folder into ~/.config/systemd/user, reloading systemd if any changed.
install_units() { # deploy-pi-dir
  local unit changed=0
  mkdir -p "$EGB_UNIT_DIR"
  for unit in "$1"/units/egb-*; do
    [ -f "$unit" ] || continue
    cmp -s "$unit" "$EGB_UNIT_DIR/$(basename "$unit")" && continue
    cp "$unit" "$EGB_UNIT_DIR/"
    changed=1
  done
  if [ "$changed" = 1 ]; then systemctl --user daemon-reload; fi
}

# Copies the deploy scripts of a deploy/pi folder into ~/egb/bin. Each is written aside and renamed over: the updater
# may be running from bin/ right now, and bash reads its script as it goes, so the old file must stay intact.
install_scripts() { # deploy-pi-dir
  local name
  for name in lib.sh update.sh release.sh activate.sh; do
    [ -f "$1/$name" ] || continue
    install -m 755 "$1/$name" "$EGB_BIN/.$name.new"
    mv -f "$EGB_BIN/.$name.new" "$EGB_BIN/$name"
  done
}

# Keeps the newest EGB_KEEP_RELEASES (default 5) releases, never the live one or the one it replaced, and clears
# pushed source trees left behind by a push that died.
prune() {
  local keep live previous dir count=0
  keep=$(setting EGB_KEEP_RELEASES 5)
  live=$(current_release)
  previous=$([ -n "$live" ] && release_field "$live" previous || true)
  while read -r dir; do
    count=$((count + 1))
    if [ "$count" -le "$keep" ] || [ "$dir" = "$live" ] || [ "$dir" = "$previous" ]; then continue; fi
    log "pruning $(basename "$dir")"
    rm -rf "$dir"
  done < <(releases_newest_first)
  find "$EGB_INCOMING" -mindepth 1 -maxdepth 1 -mmin +1440 -exec rm -rf {} +
}
