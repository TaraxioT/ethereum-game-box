# deploy/pi

Everything that turns a fresh Raspberry Pi 5 into a Game Box, and keeps it up to date.

## What goes here

| Path | Holds |
|---|---|
| `setup.sh` | One-time setup: Node, pnpm, the smart-card stack for the HYP2003 token, the browser in kiosk mode |
| `update.sh` | Pulls `main`, installs, typechecks, builds, and switches over only if all of that passed |
| `systemd/` | Units for the Box server, the screen and the updater |
| `env.example` | The Pi's settings (written to `~/.config/egb/env` on the Pi, never committed with values) |

## First milestone

A push to `main` shows up on the Pi's screen with no manual step.
