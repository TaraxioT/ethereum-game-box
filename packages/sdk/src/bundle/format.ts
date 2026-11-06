// The game bundle format: what a bundle may hold and what its manifest.json must say. Used as it is on the Box, in the
// store's and the verifier's Workers and in a browser (no Node, no DOM): whoever opens a bundle judges it with this one
// policy. A bundle is index.html, manifest.json and any assets the page uses by relative path, in the one zip shape of
// pack.ts and read.ts. Its code is untrusted and runs only in the kiosk's sandboxed frame.
import { hasOneReading, isRecord, strayKey } from "../check.ts";
import { PLAYER_LIMITS, sharedManifestProblems, type TapNeed } from "../manifest.ts";
import { printable } from "../station.ts";

export const BUNDLE_FORMAT = 1;

export const BUNDLE_LIMITS = {
  zipBytes: 16 * 1024 * 1024,
  /** Every file inflated, together: the ceiling on a zip bomb. */
  totalBytes: 32 * 1024 * 1024,
  files: 64,
  nameBytes: 120,
  manifestBytes: 32 * 1024,
  instructionsBytes: 16 * 1024,
} as const;

export interface BundleManifest {
  readonly format: typeof BUNDLE_FORMAT;
  /** Lower-case words joined by `-`, at most 40 characters. */
  readonly id: string;
  /** Printed on the cartridge: printable ASCII on one line, at most 24 characters. */
  readonly title: string;
  /** One sentence: printable ASCII on one line, at most 120 characters. */
  readonly blurb: string;
  /** How many may join: `min` at least 2, `max` at most 4. */
  readonly players: { readonly min: number; readonly max: number };
  /** The match's time limit, 1 to 30 minutes. */
  readonly minutes: number;
  /** The stakes the Box offers, in whole USDC, ascending. */
  readonly stakes: readonly number[];
  readonly taps: TapNeed;
  readonly verifier: {
    /** What the AI judge follows: printable ASCII and newlines, at most 16 KB, with no long runs of blank space. */
    readonly instructions: string;
  };
}

export interface OpenedBundle {
  readonly manifest: BundleManifest;
  /** Every file by name, `index.html` and `manifest.json` included. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The zip's sha256 as `0x` hex: the game's identity. */
  readonly hash: `0x${string}`;
}

export class BundleRefused extends Error {}

export function refuse(why: string): never {
  throw new BundleRefused(why);
}

const MANIFEST_FILE = "manifest.json";
const PAGE_FILE = "index.html";
const MANIFEST_KEYS = ["format", "id", "title", "blurb", "players", "minutes", "stakes", "taps", "verifier"];

/** Lower-case ASCII only, so no two names can be one file on another disk, and no name can climb out of its folder. */
const NAME = /^(?:[a-z0-9]+(?:[_-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*\.(?:html|css|js|png|jpg|webp|svg|woff2|mp3)$/;

/** The refusal for a file's name, or null. */
export function nameProblem(name: string): string | null {
  if (name.length > BUNDLE_LIMITS.nameBytes) return `a name over ${BUNDLE_LIMITS.nameBytes} bytes`;
  if (name === MANIFEST_FILE || NAME.test(name)) return null;
  return `${JSON.stringify(name.slice(0, 60))} isn't a name a bundle may hold`;
}

/**
 * Whether `text` is all printable ASCII, the stations' own alphabet. The team's review is the only control on what the
 * judge is told, so what a reader sees must be all there is. This refuses every invisible, bidi and look-alike
 * character at once: a list of them would never be whole, and would differ with each runtime's Unicode tables.
 */
const isPlain = (text: string): boolean => printable(text, text.length) === text;

/** Blank space long enough to push words out of a reader's sight, along the line or down the page. */
const PADDING = /[ \n]{5}/;

function playersProblem(players: unknown): string | null {
  if (!isRecord(players) || strayKey(players, ["min", "max"]) !== undefined) return "players must be { min, max }";
  const { min, max } = players;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return "players must be whole numbers";
  const [low, high] = [min as number, max as number];
  if (low < PLAYER_LIMITS.min || high > PLAYER_LIMITS.max || low > high) return `players must be ${PLAYER_LIMITS.min}–${PLAYER_LIMITS.max}, min no more than max`;
  return null;
}

function verifierProblem(verifier: unknown): string | null {
  if (!isRecord(verifier) || strayKey(verifier, ["instructions"]) !== undefined) return "verifier must be { instructions }";
  const { instructions } = verifier;
  if (typeof instructions !== "string" || instructions.trim() === "") return "verifier.instructions must be a non-empty string";
  if (!isPlain(instructions.replaceAll("\n", " "))) return "verifier.instructions must be printable ASCII and newlines";
  if (PADDING.test(instructions)) return "verifier.instructions has over 4 spaces or newlines in a row";
  if (instructions.length > BUNDLE_LIMITS.instructionsBytes) return `verifier.instructions is over ${BUNDLE_LIMITS.instructionsBytes} bytes`;
  return null;
}

/** Problems with a parsed manifest.json, in plain words; empty when it is good. */
export function bundleManifestProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["manifest.json is not an object"];
  const problems = sharedManifestProblems(value, "USDC");
  const stray = strayKey(value, MANIFEST_KEYS);
  if (stray !== undefined) problems.push(`${JSON.stringify(stray.slice(0, 60))} isn't a field a manifest may set`);
  if (value.format !== BUNDLE_FORMAT) problems.push(`format must be ${BUNDLE_FORMAT}`);
  // The Box closes the match when this runs out, so it must leave time to play.
  if (typeof value.minutes !== "number" || !(value.minutes >= 1 && value.minutes <= 30)) problems.push("minutes must be 1–30");
  for (const key of ["title", "blurb"]) {
    const text = value[key];
    if (typeof text === "string" && !isPlain(text)) problems.push(`${key} must be printable ASCII on one line`);
  }
  for (const problem of [playersProblem(value.players), verifierProblem(value.verifier)]) {
    if (problem) problems.push(problem);
  }
  return problems;
}

function parseManifest(bytes: Uint8Array): BundleManifest {
  if (bytes.length > BUNDLE_LIMITS.manifestBytes) refuse(`${MANIFEST_FILE} is over ${BUNDLE_LIMITS.manifestBytes} bytes`);
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    refuse(`${MANIFEST_FILE} isn't JSON`);
  }
  // A reader who sees the first `instructions` and a parser that keeps the last would judge two different games.
  if (!hasOneReading(text, value)) refuse(`${MANIFEST_FILE} repeats a key, or spells a value oddly`);
  const [problem] = bundleManifestProblems(value);
  if (problem) refuse(`${MANIFEST_FILE}: ${problem}`);
  return value as BundleManifest;
}

/** Judges a bundle's files, for the packer before a zip and the reader after one. Throws BundleRefused. */
export function judgeFiles(files: ReadonlyMap<string, Uint8Array>): BundleManifest {
  if (files.size > BUNDLE_LIMITS.files) refuse(`${files.size} files: at most ${BUNDLE_LIMITS.files}`);
  let total = 0;
  for (const [name, body] of files) {
    const problem = nameProblem(name);
    if (problem) refuse(problem);
    total += body.length;
  }
  if (total > BUNDLE_LIMITS.totalBytes) refuse(`the files come to ${total} B: at most ${BUNDLE_LIMITS.totalBytes} B`);
  if (!files.has(PAGE_FILE)) refuse(`no ${PAGE_FILE}`);
  const manifest = files.get(MANIFEST_FILE);
  if (!manifest) refuse(`no ${MANIFEST_FILE}`);
  return parseManifest(manifest);
}
