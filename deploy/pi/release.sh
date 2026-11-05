#!/usr/bin/env bash
# Builds one release and smoke-tests it, without touching the live Box:
#   deploy/pi/release.sh <source dir> <commit>
# Copies the source tree to ~/egb/releases/<commit>-<stamp>, installs, builds the screen, then starts the release's own
# server on a spare port against a fake receiver and a throwaway data folder. On any failure the release is removed
# and the exit status is not 0. On success the only line on stdout is the release's path; the log goes to stderr.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

[ $# -eq 2 ] || { echo "usage: release.sh <source dir> <commit>" >&2; exit 2; }
src=$(cd "$1" && pwd)
commit=$2
rel="$EGB_RELEASES/${commit:0:12}-$(date +%Y%m%d%H%M%S)"
smoke_data=
smoke_pid=
ok=0

cleanup() {
  [ -z "$smoke_pid" ] || kill "$smoke_pid" 2>/dev/null || true
  [ -z "$smoke_data" ] || rm -rf "$smoke_data"
  if [ "$ok" != 1 ]; then
    log "release of ${commit:0:12} failed; removing it"
    # Never remove a release that is live (a name clash would need two builds in the same second).
    [ "$(current_release)" = "$rel" ] || rm -rf "$rel"
  fi
}
trap cleanup EXIT

# Runs one build step with its output in a file; on failure shows the tail of it, which also lands in deploy.log.
step() { # name command...
  local name=$1
  shift
  log "$name"
  if ! "$@" >"$rel/.$name.log" 2>&1; then
    tail -n 40 "$rel/.$name.log" | tee -a "$EGB_DEPLOY_LOG" >&2
    die "$name failed"
  fi
}

lock_deploy
log "building ${commit:0:12} as $(basename "$rel")"
mkdir -p "$rel"
cp -a "$src/." "$rel/"
cd "$rel"
export CI=true

# The shared pnpm store keeps a second install fast. The release gets its own node_modules, so a build in progress
# never changes what the live Box runs.
step install lowprio pnpm install --frozen-lockfile
step build lowprio pnpm --filter @egb/box build:box
[ -f apps/box/dist/screen/index.html ] || die "the build left no apps/box/dist/screen/index.html"

# Smoke test: this release's server, the fake receiver, throwaway data, a port nothing else uses. The checks below
# also need our own process alive, so some other server answering on the port can't pass.
port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
smoke_data=$(mktemp -d)
log "smoke test on port $port"
EGB_PORT=$port EGB_DATA=$smoke_data EGB_RECEIVER=fake node apps/box/src/server/main.ts >"$rel/.smoke.log" 2>&1 &
smoke_pid=$!
if ! wait_health "$port" "$(setting EGB_SMOKE_WAIT 60)" "$smoke_pid"; then
  tail -n 40 "$rel/.smoke.log" | tee -a "$EGB_DEPLOY_LOG" >&2
  die "smoke test: /api/health did not answer ok"
fi
curl -sf -m 5 "http://127.0.0.1:$port/" | grep -qi '<html' || die "smoke test: / did not serve a page"
kill "$smoke_pid"
# The server caps its own shutdown at 10 s; give it 12, then stop waiting politely.
for _ in $(seq 24); do kill -0 "$smoke_pid" 2>/dev/null || break; sleep 0.5; done
kill -9 "$smoke_pid" 2>/dev/null || true
wait "$smoke_pid" 2>/dev/null || true
smoke_pid=

# RELEASE.json marks the release as built and tested; nothing else treats a folder as a release.
release_set "$rel" commit "$commit"
release_set "$rel" builtAt "$(date -u +%FT%TZ)"
ok=1
log "built and smoke-tested ${commit:0:12}"
printf '%s\n' "$rel"
