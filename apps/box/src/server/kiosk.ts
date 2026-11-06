// The kiosk's browser (deploy/pi/units/egb-kiosk.service) as the server sees it: something it can close, so whoever is
// at the Box can reach the Pi's desktop. Stopping the unit, not killing Chromium: the unit restarts a browser that
// dies, but a stopped unit stays down until the next deploy, a reboot or `systemctl --user start egb-kiosk`.
import { execFile } from "node:child_process";

export const KIOSK_UNIT = "egb-kiosk.service";

/** Asks systemd to stop the kiosk and returns once the stop is queued: the page asking is closed by it. */
export function stopKiosk(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("systemctl", ["--user", "stop", "--no-block", KIOSK_UNIT], { timeout: 5_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}
