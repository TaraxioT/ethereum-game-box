#!/usr/bin/env bash
# Makes a built release live:
#   deploy/pi/activate.sh [--force] <release dir or name>
# Waits for an idle Box (GET /api/state busy:false; --force doesn't wait), switches ~/egb/current atomically,
# installs the release's units and deploy scripts, checks the Box is still idle, restarts egb-server (the kiosk
# follows it), and checks /api/health. If the new server does not come up and stay up, or the tap receiver was open
# on the old release and is not on the new one, everything goes back: the previous release, its units and its
# scripts. Then prunes old releases.
# Exit status: 0 live, 1 failed (rolled back), 2 usage, 3 the Box was busy (past EGB_IDLE_WAIT, or a match started
# just before the restart): nothing changed, 4 cut short after the switch (a unit that would not install, a failed
# restart, a signal): the previous release was put back, see deploy.log.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
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

backup=
switched=0   # 1 from the switch until the new release has proven itself (or the switch was undone)
restarted=0  # 1 once egb-server was asked to restart onto the new release

switch_to() { # release
  ln -s "$1" "$EGB_HOME/current.next"
  mv -T "$EGB_HOME/current.next" "$EGB_CURRENT"
}

# The previous release, its units and its scripts back in place. The running server is not touched.
put_back() {
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    switch_to "$prev"
    install_units "$backup"
    install_scripts "$backup"
  else
    rm -f "$EGB_CURRENT"
  fi
}

# After the restart: puts the previous release back and restarts onto it. Every step is allowed to fail, so a bad
# restart can't stop the rest of the rollback.
roll_back() {
  journalctl --user -u egb-server -n 30 --no-pager 2>/dev/null | log_lines || true
  put_back || log "could not put every file of the previous release back"
  if [ -n "$prev" ] && [ -d "$prev" ]; then
    systemctl --user restart egb-server || true
    if wait_health "$(box_port)" "$(setting_int EGB_HEALTH_WAIT 45 1)"; then
      log "back on $(basename "$prev")"
    else
      log "back on $(basename "$prev"), but it does not answer either: see journalctl --user -u egb-server"
    fi
  else
    systemctl --user stop egb-server egb-kiosk || true
    log "no previous release: the Box is stopped"
  fi
}

# Runs on every way out. Once the switch is made and until the release has proven itself, leaving for any reason (a
# failed unit install or restart under set -e, a signal, a die) puts the previous release back: `current` on an
# unproven release with its units installed and nobody to say so is the one state the updater cannot see.
finish() {
  local status=$?
  trap '' HUP PIPE INT TERM # the cleanup runs to the end
  trap - EXIT
  set +e
  if [ "$switched" = 1 ]; then
    log "activating ${commit:0:12} was cut short (status $status); putting the previous release back"
    if [ "$restarted" = 1 ]; then roll_back; else put_back; fi
    # Kept for a look, but no longer offered by the updater as a built release.
    release_set "$rel" failed "$(date -u +%FT%TZ)"
    status=4
  fi
  [ -z "$backup" ] || rm -rf "$backup"
  exit "$status"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
trap 'exit 141' PIPE

if [ "$force" = 1 ]; then
  log "--force: not waiting for an idle Box"
else
  wait_idle || exit 3
fi

# The units and scripts come from the release, so changing them is just another commit. The old ones are kept until
# the new release has proven itself.
backup=$(mktemp -d)
mkdir -p "$backup/units"
cp "$EGB_UNIT_DIR"/egb-* "$backup/units/" 2>/dev/null || true
cp "$EGB_BIN"/*.sh "$backup/" 2>/dev/null || true

release_set "$rel" previous "$prev"
release_set "$rel" deployedAt "$(date -u +%FT%TZ)"
rm -f "$EGB_HOME/current.next"
# Asked now, while the old server still runs: /api/health can't say whether a release lost its tap receiver.
receiver_was_open=0
if receiver_open "$(box_port)"; then receiver_was_open=1; fi

switched=1
# From here a dropped ssh (a push's connection) must not end the deploy half way: SIGPIPE and SIGHUP are ignored, the
# log writes tolerate it, and the deploy goes on to its verdict (the result is in deploy.log).
trap '' HUP PIPE
switch_to "$rel"
install_units "$rel/deploy/pi"
install_scripts "$rel/deploy/pi"

# The last look before the one disruptive step. The wait for an idle Box ended before the switch and the unit install,
# and a match may have started since.
if [ "$force" != 1 ] && why=$(box_busy_reason); then
  log "the Box is busy again ($why): not restarting; the built release waits for the next try"
  put_back
  switched=0
  exit 3
fi

kiosk_was=$(systemctl --user is-active egb-kiosk 2>/dev/null || true)
log "restarting egb-server on ${commit:0:12}"
restarted=1
systemctl --user restart egb-server

# Healthy means /api/health answers, the unit is still up a few seconds later (Restart=always hides a crash loop behind
# the first answer), and, when the old release had the tap receiver open, the new one opens it too: the server listens
# before it opens the port, so a release that broke the serial code answers /api/health all the same.
port=$(box_port)
healthy=0
if wait_health "$port" "$(setting_int EGB_HEALTH_WAIT 45 1)"; then
  sleep 4
  if systemctl --user is-active --quiet egb-server && health_ok "$port"; then
    if [ "$receiver_was_open" != 1 ]; then
      healthy=1
    elif wait_receiver_open "$port" "$(setting_int EGB_RECEIVER_WAIT 10 1)"; then
      healthy=1
    else
      log "the tap receiver was open before the switch and is not on the new release"
    fi
  fi
fi

if [ "$healthy" != 1 ]; then
  log "the new release did not come up; rolling back"
  roll_back
  release_set "$rel" failed "$(date -u +%FT%TZ)"
  switched=0
  exit 1
fi
switched=0

# Nothing below can undo a good release, so nothing below may fail the script (the updater reads a non-zero status as
# a rollback). The kiosk is PartOf the server, so the restart above already reopened it if it was showing. Start it when
# it is meant to be up (enabled) but wasn't, e.g. the first deploy.
if [ "$kiosk_was" != active ] && systemctl --user is-enabled --quiet egb-kiosk 2>/dev/null; then
  systemctl --user start egb-kiosk || log "could not start egb-kiosk"
fi
log "live: ${commit:0:12} ($(basename "$rel"))"
prune || log "pruning old releases failed"
