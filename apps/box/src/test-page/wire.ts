// What the test page reads from the Box server's routes: the parts of each reply it draws. The server's replies
// satisfy these (server/api.ts, server/taps-api.ts), so the two can't drift apart. No DOM and no Node here.
import type { BoxState, Badge } from "../core/types.ts";
import type { TapPlan } from "../core/ports.ts";

export interface StationRow {
  readonly st: string;
  readonly seat: 0 | 1 | null;
  readonly up: boolean;
  readonly rssi: number | null;
  /** The last ping's round trip, µs. */
  readonly rttUs: number | null;
  readonly reader: boolean | null;
  readonly chip: { readonly uid: string; readonly since: number } | null;
  /** The `key=value` payload the station should show, and whether it acked it. */
  readonly screen: { readonly payload: string; readonly acked: boolean } | null;
}

export interface RosterRow {
  readonly uid: string;
  readonly key2: string;
  readonly label: string;
  readonly firstSeen: string;
}

/** GET /api/taps */
export interface TapsReply {
  readonly receiver: "serial" | "auto" | "fake" | "none";
  /** Station ids by seat, as they linked (empty: no station has that seat). */
  readonly stations: readonly [string, string];
  readonly status: {
    readonly receiver: { readonly open: boolean; readonly path: string | null; readonly lastError: string | null };
    readonly stations: readonly StationRow[];
    readonly running: number;
  } | null;
  readonly stats: {
    readonly taps: { readonly touch: number; readonly done: number; readonly fail: Readonly<Record<string, number>> };
    readonly buzz: { readonly sent: number; readonly ok: number; readonly failed: number };
  } | null;
  readonly roster: readonly RosterRow[];
  readonly fake: {
    readonly plugged: boolean;
    readonly badges: readonly { readonly name: string; readonly uid: string; readonly station: string | null }[];
  } | null;
}

/** GET /api/box */
export interface BoxReply {
  readonly state: BoxState;
  readonly power: boolean;
  /** Each badge's counted wins, losses and draws, by address. */
  readonly records: Readonly<Record<string, { readonly wins: number; readonly losses: number; readonly draws: number }>>;
}

/** POST /api/taps/inject */
export interface InjectReply {
  readonly tap: number;
  readonly plan: TapPlan;
  readonly badge: Badge;
  readonly accepted: boolean;
}

/** POST /api/taps/identify */
export interface IdentifyReply {
  readonly uid: string;
  readonly badge: Badge;
  readonly ms: number;
}

/** POST /api/taps/roll */
export interface RollReply {
  readonly uid: string;
  readonly badge: Badge;
  readonly roll: { readonly value: number; readonly counter: number };
  readonly ms: number;
}

/** POST /api/taps/press */
export interface PressReply {
  readonly st: string | null;
  readonly rttUs: number | null;
  readonly echoMs: number | null;
  readonly ackMs: number;
}

/** POST /api/taps/bench */
export interface BenchReply {
  readonly rows: readonly {
    readonly name: string;
    readonly unit: string;
    readonly n: number;
    readonly failed: number;
    readonly median: number;
    readonly p95: number;
    readonly max: number;
    readonly target: string | null;
  }[];
  readonly notes: readonly string[];
}
