#!/usr/bin/env bash
# Makes a built release live:
#   deploy/pi/activate.sh [--force] <release dir or name>
# Waits for an idle Box (GET /api/state busy:false; --force doesn't wait), switches ~/egb/current atomically,
# installs the release's units and deploy scripts, restarts egb-server (the kiosk follows it), and checks
# /api/health. If the new server does not come up and stay up, everything goes back: the previous release, its units
# and its scripts. Then prunes old releases.
# Exit status: 0 live, 1 failed (rolled back), 2 usage, 3 the Box stayed busy past EGB_IDLE_WAIT (nothing changed).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

force=0
if [ "${1:-}" = --force ]; then
  force=1
  shift
fi
[ $# -eq 1 ] || { echo "usage: activate.sh [--force] <release dir or name>" >&2; exit 2; }
case $1 in
  */*) rel=$(cd "$1" && pwd) ;;
  *) rel="$EGB_RELEASES/$1" ;;
esac
[ -f "$rel/RELEASE.json" ] || die "$rel is not a built release (no RELEASE.json): run release.sh first"
commit=$(release_field "$rel" commit)

lock_deploy
prev=$(current_release)
if [ "$prev" = "$rel" ]; then
  log "${commit:0:12} is already live"
  exit 0
fi

if [ "$force" = 1 ]; then
  log "--force: not waiting for an idle Box"
else
  wait_idle || exit 3
fi

# The units and scripts come from the release, so changing them is just another commit. The old ones are kept until
# the new release has proven itself.
backup=$(mktemp -d)
trap 'rm -rf "$backup"' EXIT
mkdir -p "$backup/units"
cp "$EGB_UNIT_DIR"/egb-* "$backup/units/" 2>/dev/null || true
cp "$EGB_BIN"/*.sh "$backup/" 2>/dev/null || true

switch_to() { # release
  ln -s "$1" "$EGB_HOME/current.next"
  mv -T "$EGB_HOME/current.next" "$EGB_CURRENT"
}

release_set "$rel" previous "$prev"
release_set "$rel" deployedAt "$(date -u +%FT%TZ)"
rm -f "$EGB_HOME/current.next"
switch_to "$rel"
install_units "$rel/deploy/pi"
install_scripts "$rel/deploy/pi"

kiosk_was=$(systemctl --user is-active egb-kiosk 2>/dev/null || true)
log "restarting egb-server on ${commit:0:12}"
systemctl --user restart egb-server

# Healthy means /api/health answers and the unit is still up a few seconds later (Restart=always hides a crash loop
# behind the first answer).
healthy=0
if wait_health "$(box_port)" "$(setting EGB_HEALTH_WAIT 45)"; then
  sleep 4
  if systemctl --user is-active --quiet egb-server && health_ok "$(box_port)"; then healthy=1; fi
fi

if [ "$healthy" != 1 ]; then
  log "the new release did not come up; rolling back"
  journalctl --user -u egb-server -n 30 --no-pager 2>/dev/null | tee -a "$EGB_DEPLOY_LOG" >&2 || true
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    switch_to "$prev"
    install_units "$backup"
    install_scripts "$backup"
    systemctl --user restart egb-server
    if wait_health "$(box_port)" "$(setting EGB_HEALTH_WAIT 45)"; then
      log "back on $(basename "$prev")"
    else
      log "back on $(basename "$prev"), but it does not answer either: see journalctl --user -u egb-server"
    fi
  else
    rm -f "$EGB_CURRENT"
    systemctl --user stop egb-server egb-kiosk
    log "no previous release: the Box is stopped"
  fi
  # Kept for a look, but no longer offered by the updater as a built release.
  release_set "$rel" failed "$(date -u +%FT%TZ)"
  exit 1
fi

# The kiosk is PartOf the server, so the restart above already reopened it if it was showing. Start it when it is
# meant to be up (enabled) but wasn't, e.g. the first deploy.
if [ "$kiosk_was" != active ] && systemctl --user is-enabled --quiet egb-kiosk 2>/dev/null; then
  systemctl --user start egb-kiosk
fi
log "live: ${commit:0:12} ($(basename "$rel"))"
prune
