// The server's settings, read once from the environment, typed and checked. A bad value stops the start with every
// problem named, rather than a Box that half works.
import { isAbsolute, join, resolve } from "node:path";
import { labelProblem } from "@egb/shared/names";

/** Where the receiver's serial port is: a path, found by its USB id (`auto`), the fake receiver, or none. */
export type ReceiverSetting =
  | { readonly kind: "serial"; readonly path: string }
  | { readonly kind: "auto" }
  | { readonly kind: "fake" }
  | { readonly kind: "none" };

/**
 * Where stakes go. `sepolia`: the relayer, signed by the Box's key through its signer daemon, read from Sepolia (the
 * Box). `demo`: the chain in memory, for the simulator (a fake or no receiver, with none of the chain settings).
 */
export type ChainSetting =
  | { readonly kind: "sepolia"; readonly signerCmd: string; readonly relayerUrl: string; readonly rpcUrl: string; readonly box: string }
  | { readonly kind: "demo" };

/** `gamebox.eth`'s admin key (`EGB_ADMIN_KEY`): the test page's Admin tab adds games and opens and closes
 *  championships with it, read and sent over `SEPOLIA_RPC_URL`. Null without the key. */
export interface AdminSetting {
  readonly key: `0x${string}`;
  readonly rpcUrl: string;
}

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
  readonly chain: ChainSetting;
  readonly admin: AdminSetting | null;
}

export const DEFAULTS = {
  port: 8790,
  host: "127.0.0.1",
  receiver: "auto",
  stations: "df3b9c,df3d88",
  box: "mumbai-01",
} as const;

/** The chain settings, all three or none (none only for the simulator). */
const CHAIN_KEYS = ["P256_SIGNER_CMD", "RELAYER_URL", "SEPOLIA_RPC_URL"] as const;

const isHttpUrl = (text: string): boolean => {
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export class SettingsError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`bad settings: ${problems.join("; ")}`);
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const STATION = /^[0-9a-f]{6}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

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
    problems.push("EGB_STATIONS must be two different station ids, P1 then P2 (six hex digits each: df3b9c,df3d88)");
  }

  // Never put a chain setting's value in a problem: the RPC URL holds the node's key.
  const box = get("EGB_BOX") ?? DEFAULTS.box;
  const boxProblem = labelProblem(box);
  if (boxProblem) problems.push(`EGB_BOX must be the Box's label (${boxProblem})`);
  const chainValues = CHAIN_KEYS.map((key) => get(key));
  const missing = CHAIN_KEYS.filter((_, i) => chainValues[i] === undefined);
  const [signerCmd, relayerUrl, rpcUrl] = chainValues;
  let chain: ChainSetting = { kind: "demo" };
  if (signerCmd !== undefined && relayerUrl !== undefined && rpcUrl !== undefined) {
    if (!isHttpUrl(relayerUrl)) problems.push("RELAYER_URL must be an http(s) URL");
    if (!isHttpUrl(rpcUrl)) problems.push("SEPOLIA_RPC_URL must be an http(s) URL");
    chain = { kind: "sepolia", signerCmd, relayerUrl, rpcUrl, box };
  } else if (missing.length < CHAIN_KEYS.length || (receiver.kind !== "fake" && receiver.kind !== "none")) {
    problems.push(`stakes go on Sepolia: set ${missing.join(", ")} (only the simulator, EGB_RECEIVER=fake or none, runs without them)`);
  }

  // The admin key is never echoed either: a problem names the variable only.
  const adminKey = get("EGB_ADMIN_KEY");
  let admin: AdminSetting | null = null;
  if (adminKey !== undefined) {
    if (!PRIVATE_KEY.test(adminKey)) problems.push("EGB_ADMIN_KEY must be a 0x-prefixed 32-byte hex private key");
    else if (rpcUrl === undefined) problems.push("EGB_ADMIN_KEY needs SEPOLIA_RPC_URL to read and send with");
    else if (isHttpUrl(rpcUrl)) admin = { key: adminKey as `0x${string}`, rpcUrl };
    else if (chain.kind !== "sepolia") problems.push("SEPOLIA_RPC_URL must be an http(s) URL");
  }

  if (problems.length > 0) throw new SettingsError(problems);
  return {
    host,
    port,
    dataDir: place(get("EGB_DATA") ?? "~/.local/share/egb", home, repoRoot),
    screenDir: place(get("EGB_SCREEN_DIR") ?? "apps/box/dist/screen", home, repoRoot),
    receiver,
    stations: [one, two],
    chain,
    admin,
  };
}
