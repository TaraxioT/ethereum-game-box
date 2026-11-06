// The server's settings, read once from the environment, typed and checked. A bad value stops the start with every
// problem named, rather than a Box that half works.
import { isAbsolute, join, resolve } from "node:path";

/** Where the receiver's serial port is: a path, found by its USB id (`auto`), the fake receiver, or none. */
export type ReceiverSetting =
  | { readonly kind: "serial"; readonly path: string }
  | { readonly kind: "auto" }
  | { readonly kind: "fake" }
  | { readonly kind: "none" };

export interface Settings {
  readonly host: string;
  readonly port: number;
  /** $EGB_DATA: ledger.json, and later sessions/ and badges.json. */
  readonly dataDir: string;
  /** The built screen (`pnpm --filter @egb/box build:box`). */
  readonly screenDir: string;
  readonly receiver: ReceiverSetting;
  /** The station ids at Player 1's and Player 2's seats: the last three bytes of each MAC, lower-case hex. */
  readonly stations: readonly [string, string];
}

export const DEFAULTS = {
  port: 8790,
  host: "127.0.0.1",
  receiver: "auto",
  stations: "e4ba70,df3d88",
} as const;

export class SettingsError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`bad settings: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const STATION = /^[0-9a-f]{6}$/;

/** `~/x` from home; a relative path from the repo root, so the server finds the same folders from any directory. */
function place(value: string, home: string, repoRoot: string): string {
  if (value === "~" || value.startsWith("~/")) return join(home, value.slice(1));
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

export function readSettings(env: Env, home: string, repoRoot: string): Settings {
  const problems: string[] = [];
  const get = (key: string): string | undefined => env[key]?.trim() || undefined;

  const portText = get("EGB_PORT") ?? String(DEFAULTS.port);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) problems.push(`EGB_PORT must be a port number, not "${portText}"`);

  const host = get("EGB_HOST") ?? DEFAULTS.host;

  const receiverText = get("EGB_RECEIVER") ?? DEFAULTS.receiver;
  let receiver: ReceiverSetting = { kind: "none" };
  if (receiverText === "auto" || receiverText === "fake" || receiverText === "none") receiver = { kind: receiverText };
  else if (receiverText.startsWith("/")) receiver = { kind: "serial", path: receiverText };
  else problems.push(`EGB_RECEIVER must be a serial port's path, auto, fake or none, not "${receiverText}"`);

  const stationIds = (get("EGB_STATIONS") ?? DEFAULTS.stations).split(",").map((id) => id.trim().toLowerCase());
  const [one = "", two = ""] = stationIds;
  if (stationIds.length !== 2 || !STATION.test(one) || !STATION.test(two) || one === two) {
    problems.push("EGB_STATIONS must be two different station ids, P1 then P2 (six hex digits each: e4ba70,df3d88)");
  }

  if (problems.length > 0) throw new SettingsError(problems);
  return {
    host,
    port,
    dataDir: place(get("EGB_DATA") ?? "~/.local/share/egb", home, repoRoot),
    screenDir: place(get("EGB_SCREEN_DIR") ?? "apps/box/dist/screen", home, repoRoot),
    receiver,
    stations: [one, two],
  };
}
