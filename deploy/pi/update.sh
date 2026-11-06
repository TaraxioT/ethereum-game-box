#!/usr/bin/env bash
# The updater, run every 30 s by egb-update.timer (and by hand): fetches EGB_DEPLOY_BRANCH (default main) from
# EGB_REPO_URL into ~/egb/repo, and when the branch has a commit it has not handled yet, builds it (release.sh) and
# makes it live (activate.sh).
#
# - It needs EGB_REPO_URL in ~/.config/egb/env and a read-only deploy key (EGB_DEPLOY_KEY, default ~/.ssh/egb_deploy)
#   that the repo accepts. Without them it says so once and exits 0, so the timer never shows a failure for a Box
#   that is simply not wired up yet.
# - A commit that fails to build or to come up is remembered and not retried; the next commit gets a fresh try.
#   To retry one anyway: rm ~/egb/state/last-seen.
# - A push from a laptop (push.sh) stays live until the branch moves again: only a new commit on the branch deploys.
# - If the Box stays busy past EGB_IDLE_WAIT, the built release waits and the next run activates it.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(dirname "$0")/lib.sh"

lock_deploy --quiet

branch=$(setting EGB_DEPLOY_BRANCH main)
url=$(setting EGB_REPO_URL)
key=$(setting EGB_DEPLOY_KEY "$HOME/.ssh/egb_deploy")
seen_file="$EGB_STATE/last-seen"

if [ -z "$url" ]; then
  log_once update "updater idle: set EGB_REPO_URL in $EGB_ENV_FILE (the repo to follow)"
  exit 0
fi
if [ ! -f "$key" ]; then
  log_once update "updater idle: no deploy key at $key; add it to the repo (read-only) and the updater starts"
  exit 0
fi

export GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
[ -d "$EGB_REPO" ] || git init -q --bare "$EGB_REPO"
git -C "$EGB_REPO" remote add origin "$url" 2>/dev/null || git -C "$EGB_REPO" remote set-url origin "$url"
# One branch, one commit deep: the Pi only ever builds the tip.
if ! out=$(git -C "$EGB_REPO" fetch -q --no-tags --depth 1 origin "+refs/heads/$branch:refs/egb/deploy" 2>&1); then
  log_once update "updater idle: cannot fetch $branch (is the deploy key added to the repo? is the network up?): $(printf '%s' "$out" | tail -n 1 | redact)"
  exit 0
fi
rm -f "$EGB_STATE/said-update"

sha=$(git -C "$EGB_REPO" rev-parse refs/egb/deploy)
short=${sha:0:12}
[ "$sha" = "$(cat "$seen_file" 2>/dev/null || true)" ] && exit 0
live=$(current_release)
if [ -n "$live" ] && [ "$sha" = "$(release_field "$live" commit)" ]; then
  echo "$sha" >"$seen_file"
  exit 0
fi

log "$branch is at $short: updating"
rel=$(built_release_for "$sha" || true)
if [ -z "$rel" ]; then
  src="$EGB_INCOMING/$short-update"
  trap 'rm -rf "$src"' EXIT
  rm -rf "$src"
  mkdir -p "$src"
  git -C "$EGB_REPO" archive "$sha" | tar -x -C "$src"
  if ! rel=$(bash "$src/deploy/pi/release.sh" "$src" "$sha"); then
    echo "$sha" >"$seen_file"
    die "$short did not build; not retrying it until $branch moves"
  fi
fi

code=0
bash "$rel/deploy/pi/activate.sh" "$rel" || code=$?
case $code in
  0) echo "$sha" >"$seen_file" ;;
  3) log "$short is built and waits for the Box to be idle" ;;
  *)
    echo "$sha" >"$seen_file"
    die "$short did not come up and was rolled back; not retrying it until $branch moves"
    ;;
esac
