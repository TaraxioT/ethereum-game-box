# deploy/pi

Everything that turns a Raspberry Pi 5 into the Box and keeps it updated: one-time setup, building a release,
switching to it (and back), the updater, a push from a laptop, and the systemd units.

## What goes here

| Path | Holds |
|---|---|
| `setup.sh` | One-time, idempotent setup on the Pi: Node, pnpm, `uhubctl`, groups, udev, the nice limit, the env file, linger, the units |
| `lib.sh` | Shared by the Pi scripts: the layout, `log`, `setting` and `setting_int`, the health, receiver and idle waits, the deploy lock, pruning |
| `release.sh` | `release.sh <source dir> <commit>`: copies a tree to `~/egb/releases/`, installs, builds, smoke-tests; removes it on failure |
| `activate.sh` | `activate.sh [--force] <release>`: waits for an idle Box, switches `current`, restarts, checks health and the receiver, rolls back on failure or interruption, prunes |
| `update.sh` | The updater: follows `EGB_DEPLOY_BRANCH`, and runs release then activate on a new commit |
| `push.sh` | Run on the laptop: sends a commit to the Pi and runs release then activate there |
| `kiosk-prestart.sh` | Runs before the kiosk browser starts: waits for the server and the display, clears a stale window placement |
| `units/egb-server.service` | The Box server (`node apps/box/src/server/main.ts`, `Nice=-5`) |
| `units/egb-kiosk.service` | Full-screen Chromium on `http://127.0.0.1:8790/` |
| `units/egb-update.service`, `units/egb-update.timer` | The updater and its 30 s timer |
| `egb-receiver.rules` | udev: `/dev/egb-receiver` for the receiver, and USB hub access for `uhubctl` |
| `env.example` | Every setting, with empty secrets; copied to `~/.config/egb/env` on the Pi, never committed with values |

Every script passes `shellcheck -x`.

## Layout on the Pi

```
~/egb/repo/               bare mirror of the Git remote (the updater's)
~/egb/incoming/<commit>/  a tree pushed from a laptop; removed once built
~/egb/releases/<commit>-<stamp>/   one built tree per deploy (node_modules, apps/box/dist, RELEASE.json)
~/egb/current             symlink to the live release; the server unit runs from here
~/egb/bin/                stable copies of lib, update, release and activate (refreshed on every good activation)
~/egb/state/              deploy.log, and the updater's memory (last-seen)
~/.config/egb/env         the settings and secrets, mode 600
~/.local/share/egb/       the Box's data (EGB_DATA): ledger, badges, games, sessions. A deploy never touches it.
~/.local/lib/nodejs/, ~/.local/bin/{node,npm,npx,corepack,pnpm}   Node and pnpm, ahead of the system's own
```

`RELEASE.json` in a release holds `commit`, `builtAt` (written when the smoke test passed, so a folder without it is
not a release), and after activation `deployedAt` and `previous` (the release it replaced). A release that failed to
come up gets `failed` and is never offered again.

## First-time setup

From the repo root on the laptop (the Pi needs only `deploy/pi` and `package.json` for this):

```sh
rsync -a --relative deploy/pi package.json pi:egb-setup/
ssh pi 'bash ~/egb-setup/deploy/pi/setup.sh --boot'
```

`NODE_MAJOR=26` is the default; pass another major in front of `bash` if the laptop runs a different one. `--boot` makes
`egb-server` and `egb-kiosk` start at boot (and lets a deploy start the screen); without it nothing is enabled.
The script needs `sudo` for apt, udev, the limits file and linger. It prints the deploy key's public half at the end.

It is safe to rerun: Node is downloaded only when the major differs, apt installs only missing packages (nothing is
upgraded), and `~/.config/egb/env` is never overwritten. Then fill the keys in on the Pi:

```sh
ssh pi 'nano ~/.config/egb/env'
```

## Push to the Pi

```sh
deploy/pi/push.sh                # this checkout's HEAD
deploy/pi/push.sh my-branch      # a branch's tip
deploy/pi/push.sh --force        # don't wait for an idle Box
EGB_PI_HOST=pi-ip deploy/pi/push.sh   # another ssh destination (default: pi)
```

It sends `git archive` of the commit: tracked files only, so `.env`, untracked files and uncommitted edits never leave
the laptop. On the Pi it builds into a new release, smoke-tests it, waits for an idle Box, switches over, and rolls
back if the server doesn't come up. A pushed commit stays live until the updater's branch gets a new commit.

## The release and the switch

`release.sh` copies the tree, runs `pnpm install --frozen-lockfile` and `pnpm --filter @egb/box build:box` at low
priority (so a build during a match doesn't slow the taps), then starts the release's own server on a free port with
`EGB_RECEIVER=fake` and an empty data folder. It must answer `/api/health` with `ok: true` and serve HTML at `/`, while
its own process is alive. Any failure removes the release and exits non-zero.

`activate.sh` waits until `GET /api/state` says `busy: false`, for at most `EGB_IDLE_WAIT` seconds (900; `--force`
doesn't wait). A Box that isn't running is idle; one whose unit is up but does not answer is busy (a plain 404, a
release without the route, counts as idle). It notes whether the tap receiver is open on the running release
(`GET /api/taps`, `status.receiver.open`: `/api/health` can't tell, because the server listens before it opens the
port). Then it:

1. points `~/egb/current` at the release with `ln -s` to a temporary name and `mv -T`, which is atomic;
2. installs the release's units and scripts (so changing them is just another commit), keeping the old ones;
3. looks at `/api/state` once more, right before the restart: a match that started since (the wait ended before the
   switch and the unit install) puts everything back and exits 3, without restarting;
4. restarts `egb-server` (the kiosk is `PartOf` it, so a running screen reloads) and waits for `/api/health`, checks
   again 4 s later that the unit is still up, and, if the receiver was open before, waits up to `EGB_RECEIVER_WAIT`
   seconds (10) for the new release to report `receiver.open`;
5. on failure, switches back to the previous release, restores its units and scripts and restarts;
6. prunes to the newest `EGB_KEEP_RELEASES` (5), never the live release or the one before it. A failure after a good
   release is live (the kiosk start, the prune) is logged and never changes the exit status.

From the switch until step 4 passes, an exit trap guards the deploy: any way out (a unit that won't install, a failed
restart, `SIGTERM`/`SIGINT`) puts the previous release, units and scripts back (restarting onto it if the server had
been restarted), marks the release failed and exits 4. `SIGHUP` and `SIGPIPE` are ignored from the switch on and the log
writes tolerate a dead stderr, so a push whose ssh connection drops still reaches a verdict, written to `deploy.log`.

Exit status: 0 live, 1 failed and rolled back, 2 usage, 3 the Box was busy (nothing changed), 4 cut short after the
switch and put back. A release that is marked `failed` is never offered again.

## The updater

`egb-update.timer` runs `~/egb/bin/update.sh` 1 minute after boot and then 30 s after each run. It fetches
`EGB_DEPLOY_BRANCH` (default `main`) from `EGB_REPO_URL` with the key in `EGB_DEPLOY_KEY` (default
`~/.ssh/egb_deploy`), and when the branch has a commit it hasn't handled, it builds and activates it.

It is installed but **not enabled**. Until `EGB_REPO_URL` is set and the repo accepts the key, it logs one line saying
what is missing (in `~/egb/state/deploy.log`) and exits 0. To switch it on:

1. Add the key printed by `setup.sh` (or `cat ~/.ssh/egb_deploy.pub`) to the repo as a read-only deploy key.
2. Set `EGB_REPO_URL` in `~/.config/egb/env` (the commented example in `env.example` is this repo).
3. `systemctl --user enable --now egb-update.timer`

A commit that fails to build, to come up (activate exit 1) or to finish going live (exit 4) is remembered and not
retried; the next commit gets a fresh try (to retry one anyway: `rm ~/egb/state/last-seen`). If the Box is busy past
`EGB_IDLE_WAIT` (exit 3), the built release waits and the next tick activates it without rebuilding. The update service
runs at `Nice=15` with idle I/O.

The update service has **no `EnvironmentFile`**: the updater reads the few settings it needs (`EGB_REPO_URL`,
`EGB_DEPLOY_BRANCH`, `EGB_DEPLOY_KEY`, the waits, the port) from `~/.config/egb/env` itself with `setting`, so the API
keys in that file never reach `pnpm install`, the build or the smoke test. `setting` parses the file (it is never
sourced), takes a quoted value as written, drops a trailing ` # comment` from an unquoted one, and `setting_int`
falls back to the default, with one log line, for a value that is not a whole number (so `EGB_KEEP_RELEASES=lots`
can't make the prune delete everything). systemd itself keeps an inline comment as part of the value for the
server's own `EnvironmentFile`, so keep comments on their own lines.

## The units

All are systemd user units in `~/.config/systemd/user/`; linger keeps them running with nobody logged in.

- **`egb-server`**: `WorkingDirectory=%h/egb/current`, `EnvironmentFile=%h/.config/egb/env`, `Restart=always` with no
  start limit. It `Conflicts` with the previous Box's units and the ESP monitor, because one process owns the receiver's
  port. `ExecStart` goes through `/usr/bin/env node` with `PATH` led by `~/.local/bin`, so it runs the Node 26 that
  `setup.sh` installed, not the system's.
- **`egb-kiosk`**: Chromium on Wayland (`--kiosk --app`, full screen, own profile `~/.config/egb-chromium`) with the
  flags the Pi's working kiosk uses, plus `--autoplay-policy` and `--use-fake-ui-for-media-stream` for sounds and
  push-to-talk. It touches no audio setting. `kiosk-prestart.sh` runs first (server up, display socket there, stale
  placement cleared). It restarts forever, so it waits out the desktop at boot.
- **`egb-update.service`** and **`egb-update.timer`**: see above.

**`Nice=-5` needs a raised limit.** On this Pi a user manager's `Max nice priority` is 0 (see
`/proc/<pid of systemd --user>/limits`), so a user unit with `Nice=-5` fails with status 201/NICE, and
`AmbientCapabilities=CAP_SYS_NICE` can't help (the user manager has no capability to hand on). `setup.sh` therefore
writes `/etc/security/limits.d/60-egb-nice.conf` (`pi - nice -5`, read by the user manager's PAM session on its next
start) and applies the same limit to the running manager with `prlimit`, then checks it.

## Rolling back by hand

```sh
ssh pi
ls -1 ~/egb/releases                                   # names end in the build stamp
node -p "require(process.env.HOME + '/egb/current/RELEASE.json').previous"   # the release before the live one
~/egb/bin/activate.sh --force <release name>           # same switch, health check and rollback as a deploy
```

Or by hand: `ln -s ~/egb/releases/<name> ~/egb/current.next && mv -T ~/egb/current.next ~/egb/current && systemctl
--user restart egb-server`. Turn the updater off while you stay on an old release (`systemctl --user disable --now
egb-update.timer`), or it moves forward again on the next commit. Logs: `~/egb/state/deploy.log`,
`journalctl --user -u egb-server -f`.

## Going back to the previous Box

```sh
systemctl --user stop egb-kiosk egb-server egb-update.timer
systemctl --user disable egb-server egb-kiosk egb-update.timer
systemctl --user enable --now esp-monitor.service gamebox-deploy.timer
systemctl --user start gamebox-server gamebox-ui
```

Starting either side stops the other's units (they `Conflict`), but stop the `egb-*` ones first so the receiver's port
is free. To come back: `systemctl --user stop gamebox-server gamebox-ui gamebox-deploy.timer esp-monitor` and start
`egb-server` (and `egb-kiosk`).
