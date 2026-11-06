// Chromium for the tests that need a real browser, started as the Pi's kiosk unit starts it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findChromium(): string | null {
  const cache = path.join(homedir(), "Library/Caches/ms-playwright");
  const playwright = existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort()
        .reverse()
        .map((name) => path.join(cache, name, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"))
    : [];
  const candidates = [process.env.EGB_CHROMIUM, "/usr/bin/chromium", ...playwright, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return candidates.find((file): file is string => file !== undefined && existsSync(file)) ?? null;
}

/** EGB_CHROMIUM, else the Pi's, Playwright's or Chrome; null with none of them. */
export const CHROMIUM = findChromium();

/** The flags that only place a window on the Pi's display or name its folders: a headless browser has neither. */
const DISPLAY_ONLY = /^--(kiosk|app|start-fullscreen|window-|user-data-dir|password-store|ozone-platform)/;

/** The flags the Pi's kiosk starts Chromium with, split as systemd splits ExecStart: on spaces, outside double quotes. */
export function kioskFlags(): string[] {
  const unit = readFileSync(fileURLToPath(new URL("../../../../../deploy/pi/units/egb-kiosk.service", import.meta.url)), "utf8").replaceAll("\\\n", " ");
  const start = /^ExecStart=(.*)$/m.exec(unit)?.[1] ?? "";
  return [...start.matchAll(/"([^"]*)"|\S+/g)].map(([word, quoted]) => quoted ?? word).filter((word) => word.startsWith("--"));
}

/** `kioskFlags()` for a headless browser, with what it needs to start clean from `profile`, a folder of its own. */
export function headlessFlags(profile: string): string[] {
  return [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    ...kioskFlags().filter((flag) => !DISPLAY_ONLY.test(flag)),
  ];
}
