// A store game's match log: what the verifier judges. The Box writes every entry. `src: "box"` is what the Box itself
// saw; `src: "game"` is what the game's own page claimed, which a rigged game can make up.
import { hasOneReading, isRecord, strayKey } from "./check.ts";
import { isGameId, PLAYER_LIMITS } from "./manifest.ts";

export interface LogHeader {
  readonly v: 1;
  /** The Box's label, such as `mumbai-01`. */
  readonly box: string;
  /** The pot's round, a decimal uint256. */
  readonly round: string;
  /** The bundle's sha256, as `0x` hex. */
  readonly bundle: `0x${string}`;
  /** The manifest's id. */
  readonly game: string;
  /** Each seat's address, in seat order. A verdict's payouts follow this order. */
  readonly players: readonly `0x${string}`[];
  /** Each player's stake in USDC base units (6 decimals), a decimal string. */
  readonly amount: string;
  /** ms since the epoch, the Box's clock. */
  readonly startedAt: number;
}

export type LogEntry =
  /** A badge's tap. `roll` is its verified roll, on `random` taps. */
  | { readonly src: "box"; readonly t: "tap"; readonly seat: number; readonly at: number; readonly roll: number | null }
  /** The match closed: the game called `end()`, the manifest's time ran out, or the frame was lost. */
  | { readonly src: "box"; readonly t: "end"; readonly at: number; readonly why: "game" | "time" | "lost" }
  /** Something the game posted. `at` is the Box's clock on arrival. */
  | { readonly src: "game"; readonly t: "event"; readonly at: number; readonly name: string; readonly data: unknown };

export interface MatchLog {
  readonly header: LogHeader;
  readonly entries: readonly LogEntry[];
}

export const LOG_LIMITS = { entries: 5000, eventName: 40, eventDataBytes: 1024, logBytes: 1024 * 1024 } as const;

const LOG_KEYS = ["header", "entries"];
const HEADER_KEYS = ["v", "box", "round", "bundle", "game", "players", "amount", "startedAt"];
const TAP_KEYS = ["src", "t", "seat", "at", "roll"];
const END_KEYS = ["src", "t", "at", "why"];
const EVENT_KEYS = ["src", "t", "at", "name", "data"];

/** `GameBoxNames`' label rule: 3 to 32 of `a-z`, `0-9` and `-`, with no hyphen at either end. */
const LABEL = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const BUNDLE_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_ROLL = 0xffffffff;

const matches = (pattern: RegExp, value: unknown): value is string => typeof value === "string" && pattern.test(value);
const isUint256 = (value: unknown): value is string => matches(DECIMAL, value) && BigInt(value) <= MAX_UINT256;
/** A touch's time is worked out from microseconds, so it needn't be whole. */
const isTime = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Bytes of UTF-8, counted by hand: the Box's core compiles this file with no TextEncoder. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** How many bytes `value` is as JSON, or null if it isn't JSON at all. */
function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : utf8Bytes(text);
  } catch {
    return null;
  }
}

function playersProblem(players: unknown): string | null {
  if (!Array.isArray(players) || players.length < PLAYER_LIMITS.min || players.length > PLAYER_LIMITS.max) return `header.players must list ${PLAYER_LIMITS.min}–${PLAYER_LIMITS.max} addresses`;
  if (!players.every((player) => matches(ADDRESS, player))) return "header.players must be addresses";
  if (new Set(players.map((player: string) => player.toLowerCase())).size !== players.length) return "header.players repeats an address";
  return null;
}

function headerProblems(header: unknown): string[] {
  if (!isRecord(header)) return ["header is not an object"];
  const problems: string[] = [];
  if (strayKey(header, HEADER_KEYS) !== undefined) problems.push("header has a stray field");
  if (header.v !== 1) problems.push("header.v must be 1");
  if (!matches(LABEL, header.box)) problems.push("header.box must be a Box's label");
  if (!isUint256(header.round)) problems.push("header.round must be a decimal uint256");
  if (!matches(BUNDLE_HASH, header.bundle)) problems.push("header.bundle must be a sha256 in 0x hex");
  if (!isGameId(header.game)) problems.push("header.game must be a game's id");
  const players = playersProblem(header.players);
  if (players) problems.push(players);
  if (!isUint256(header.amount) || header.amount === "0") problems.push("header.amount must be a decimal uint256 above 0");
  if (!isTime(header.startedAt)) problems.push("header.startedAt must be a time");
  return problems;
}

function tapProblem(entry: Record<string, unknown>, seats: number): string | null {
  if (strayKey(entry, TAP_KEYS) !== undefined) return "has a stray field";
  const { seat, roll } = entry;
  if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) >= seats) return "names a seat the match doesn't have";
  if (roll !== null && !(Number.isInteger(roll) && (roll as number) >= 0 && (roll as number) <= MAX_ROLL)) return "must have a uint32 roll, or null";
  return null;
}

function endProblem(entry: Record<string, unknown>): string | null {
  if (strayKey(entry, END_KEYS) !== undefined) return "has a stray field";
  return entry.why === "game" || entry.why === "time" || entry.why === "lost" ? null : "must say why the match closed";
}

function eventProblem(entry: Record<string, unknown>): string | null {
  if (strayKey(entry, EVENT_KEYS) !== undefined) return "has a stray field";
  const { name, data } = entry;
  if (typeof name !== "string" || name === "" || name.length > LOG_LIMITS.eventName) return `must have a name of 1–${LOG_LIMITS.eventName} characters`;
  const bytes = jsonBytes(data);
  if (bytes === null) return "must have JSON data";
  return bytes > LOG_LIMITS.eventDataBytes ? `has data over ${LOG_LIMITS.eventDataBytes} bytes` : null;
}

function entryProblem(entry: unknown, seats: number): string | null {
  if (!isRecord(entry)) return "is not an object";
  if (!isTime(entry.at)) return "must have a time";
  if (entry.src === "box" && entry.t === "tap") return tapProblem(entry, seats);
  if (entry.src === "box" && entry.t === "end") return endProblem(entry);
  if (entry.src === "game" && entry.t === "event") return eventProblem(entry);
  return "is not a Box's tap or end, or a game's event";
}

/**
 * Problems with a parsed match log, in plain words; empty when it is good. For the verifier, on input it can't trust:
 * nothing in a problem quotes the log, and it stops at the first bad entry. A good log closes with its one `end`.
 * `logBytes` is checked on the value, which is as short as its text can be. A log that arrives as text goes through
 * `logTextProblems`, which sees what parsing throws away.
 */
export function logProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["the log is not an object"];
  if (strayKey(value, LOG_KEYS) !== undefined) return ["the log has a stray field"];
  const header = headerProblems(value.header);
  if (header.length > 0) return header;
  const { entries } = value;
  if (!Array.isArray(entries)) return ["entries must be a list"];
  if (entries.length > LOG_LIMITS.entries) return [`the log has over ${LOG_LIMITS.entries} entries`];
  if (entries.length === 0) return ["the log has no end"];
  const bytes = jsonBytes(value);
  if (bytes === null) return ["the log is not JSON"];
  if (bytes > LOG_LIMITS.logBytes) return [`the log is over ${LOG_LIMITS.logBytes} bytes`];
  const seats = ((value.header as Record<string, unknown>).players as readonly unknown[]).length;
  for (const [i, entry] of entries.entries()) {
    const problem = entryProblem(entry, seats);
    if (problem) return [`entry ${i} ${problem}`];
    const last = i === entries.length - 1;
    if ((entry as LogEntry).t === "end" && !last) return [`entry ${i} closes the match before the last entry`];
    if ((entry as LogEntry).t !== "end" && last) return ["the log has no end"];
  }
  return [];
}

/**
 * Problems with a log's exact JSON text, in plain words; empty when it is good. For the verifier, on the text the Box
 * signed. The agent and the audit record get that text, not the parsed value, so a repeated key would read one way to
 * them and another to `logProblems`, and a signed record could be read two ways.
 */
export function logTextProblems(text: string): string[] {
  if (utf8Bytes(text) > LOG_LIMITS.logBytes) return [`the log is over ${LOG_LIMITS.logBytes} bytes`];
  let value: unknown;
  try {
    value = JSON.parse(text);
    if (!hasOneReading(text, value)) return ["the log repeats a key, or spells a value oddly"];
  } catch {
    return ["the log is not JSON"];
  }
  return logProblems(value);
}
