#!/usr/bin/env bash
# Run on the laptop: puts a commit on the Pi's screen through the same release and activate steps the updater uses.
#   deploy/pi/push.sh [--force] [branch]
# - With no branch it pushes this checkout's HEAD; with one, that branch's tip (a local branch, else origin/<branch>).
# - It sends `git archive` of that commit: tracked files only, so a .env, untracked files and uncommitted edits
#   never leave the laptop.
# - It builds and smoke-tests on the Pi, waits for an idle Box, switches over and rolls back on failure.
#   --force doesn't wait for the Box to be idle.
# - Host: EGB_PI_HOST (default pi), any ssh destination.
# A pushed commit stays live until the updater's branch moves again.
set -euo pipefail

force=
if [ "${1:-}" = --force ]; then
  force=--force
  shift
fi
[ $# -le 1 ] || { echo "usage: push.sh [--force] [branch]" >&2; exit 2; }
host=${EGB_PI_HOST:-pi}
ssh_opts=(-o ConnectTimeout=10)

cd "$(git rev-parse --show-toplevel)"
if [ $# -eq 1 ]; then
  ref=
  for candidate in "refs/heads/$1" "refs/remotes/origin/$1" "$1"; do
    if git rev-parse --verify --quiet "$candidate^{commit}" >/dev/null; then
      ref=$candidate
      break
    fi
  done
  [ -n "$ref" ] || { echo "no such branch or commit: $1" >&2; exit 1; }
else
  ref=HEAD
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "warning: uncommitted changes are not sent; only the commit is" >&2
  fi
fi
commit=$(git rev-parse --verify "$ref^{commit}")
short=$(git rev-parse --short=12 "$commit")
echo "pushing $short ($ref) to $host" >&2

# 1. The source tree lands in ~/egb/incoming/<commit>. The folder name is a full commit hash, so it is safe to quote
#    into the remote command.
# shellcheck disable=SC2029
git archive --format=tar.gz "$commit" |
  ssh "${ssh_opts[@]}" "$host" "set -e; dir=\"\$HOME/egb/incoming/$commit\"; rm -rf \"\$dir\"; mkdir -p \"\$dir\"; tar -xz -C \"\$dir\""

# 2. Build and activate from that tree, holding the deploy lock across both so the updater can't slip in between.
#    The tree is removed afterwards, whatever happens.
ssh "${ssh_opts[@]}" "$host" bash -s -- "$commit" "$force" <<'REMOTE'
set -euo pipefail
commit=$1
force=${2:-}
dir="$HOME/egb/incoming/$commit"
trap 'rm -rf "$dir"' EXIT
. "$dir/deploy/pi/lib.sh"
lock_deploy
rel=$(bash "$dir/deploy/pi/release.sh" "$dir" "$commit")
bash "$dir/deploy/pi/activate.sh" ${force:+"$force"} "$rel"
REMOTE

echo "live on $host: $short" >&2
