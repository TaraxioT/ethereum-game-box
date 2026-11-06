// The core's ports: everything the phase machine needs from the world. The core has no DOM and no Node APIs and reads
// no global clock; a host (SimLink in the browser, the Box server on the Pi) hands it these.
import type { Seat, StationView, Transcript, BuiltEvent, Outcome, TapNeed } from "@egb/sdk";
import type { Badge, GameInfo } from "./types.ts";

/** An opaque timer handle. */
export type TimerHandle = { readonly __timer: true };

export interface Clock {
  /** ms since the epoch. */
  now(): number;
  after(ms: number, run: () => void): TimerHandle;
  every(ms: number, run: () => void): TimerHandle;
  cancel(handle: TimerHandle | null): void;
}

/** The tap stations, by seat. */
export interface StationsPort {
  /** What the seat's station shows now. Hosts send it on change, on relink and every 5 s. */
  show(seat: Seat, view: StationView): void;
  /** `ok`: one short buzz (an accepted tap). `no`: two short (a refused one). */
  buzz(seat: Seat, kind: "ok" | "no"): void;
}

/** What the next tap at a seat should ask of the badge. `none`: the tap means nothing now (still identified). */
export type TapPlan = TapNeed | "none";

export type TapErrorCode = "lifted" | "radio" | "not-halo" | "refused" | "verify" | "link";

/**
 * One physical tap at a seat: a `touch` (the chip landed), then exactly one `done` or `fail`. All three share `tap`.
 * `at` is when the chip touched the reader, on the host's clock, for all three.
 */
export type TapEvent =
  | {
      readonly phase: "touch";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      /** Known from the roster by UID, or null for a chip this Box hasn't read yet. */
      readonly badge: Badge | null;
    }
  | {
      readonly phase: "done";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      readonly badge: Badge;
      /** The badge's verified roll (uint32) when the plan was `random`, else null. */
      readonly roll: number | null;
    }
  | {
      readonly phase: "fail";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      readonly badge: Badge | null;
      readonly error: { readonly code: TapErrorCode; readonly text: string };
    };

/** The simulated ledger as stored: a balance per badge address, and the open match's stakes by the badge that put each in. */
export interface LedgerData {
  readonly balances: Readonly<Record<string, number>>;
  readonly escrow: Readonly<Record<string, number>>;
}

/** Where the ledger lives: memory in the browser, $EGB_DATA/ledger.json (written atomically) on the Pi. */
export interface LedgerStore {
  load(): LedgerData;
  save(ledger: LedgerData): void;
}

/** The games the Box can run: the team games plus the installed built games. */
export interface LibraryPort {
  games(): readonly GameInfo[];
  /** Calls back when a game is installed or removed. */
  subscribe(listener: () => void): () => void;
}

/** A built game's rules, after a start or a step. */
export interface RulesSnapshot {
  readonly state: unknown;
  readonly outcome: Outcome | null;
  readonly stations: readonly [StationView, StationView];
}

/**
 * A built game's rules, run outside the core (a sandboxed child process on the Pi). One game at a time. A rejected
 * promise (over budget, crashed, stopped) voids the match: both stakes go back.
 */
export interface RulesRunnerPort {
  /** Starts the game's process (at Join), so the first step pays no start-up cost. */
  prepare(game: string): void;
  start(game: string, seed: number, now: number): Promise<RulesSnapshot>;
  step(event: BuiltEvent): Promise<RulesSnapshot>;
  /** Stops the process; a pending call rejects. */
  stop(): void;
}

/** Where finished matches go: the session log on the Pi, nowhere in the demo. */
export interface MatchLog {
  record(transcript: Transcript): void;
  /** How many counted results this pair of badges (either seat) has had since `since` (ms since the epoch). */
  countedSince(badges: readonly [string, string], since: number): number;
}

/**
 * Where a tap came from. Only a station's tap is one the Box saw: injected taps (the test page) and Demo mode's
 * screen play like any other, but they are not evidence for a counted result.
 */
export type TapSource = "station" | "injected";

export interface CorePorts {
  readonly clock: Clock;
  readonly stations: StationsPort;
  readonly ledger: LedgerStore;
  readonly library: LibraryPort;
  /** Absent: built games can't run (the demo). */
  readonly rules?: RulesRunnerPort;
  readonly log: MatchLog;
  /** uint32 randomness for seeds and the simulated chain (not for game outcomes on a real Box: badges roll those). */
  readonly random: () => number;
}
