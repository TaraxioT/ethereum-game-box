// Quick Draw's state and events. The rules (rules.ts) are pure: time and seeds arrive in events.
import type { DuelSeat } from "@egb/sdk";

/**
 * `count`: 3-2-1 before a standoff (taps change nothing). `wait`: the sign reads WAIT…, decoys may show, a tap is a
 * foul. `draw`: the sign reads DRAW, the first tap takes the round. `round`: a round was decided (or nobody took it)
 * and the next one is about to be counted in. `done`: the match is over.
 */
export type QuickDrawPhase = "count" | "wait" | "draw" | "round" | "done";

/** A decoy: from `at` for DECOY_MS the sign shows `word` instead of WAIT…. Tapping on it is a foul like any early tap. */
export interface Decoy {
  readonly at: number;
  readonly word: string;
}

/** How a standoff ended. `first`: a good draw took it. `early`: the other seat tapped before DRAW (a foul). `heat`:
 *  both drew on the same millisecond. `slow`: nobody drew in time. The last two give nobody the round. */
export type QuickDrawReason = "first" | "early" | "heat" | "slow";

export interface QuickDrawState {
  readonly phase: QuickDrawPhase;
  readonly seed: number;
  /** 1 for the first standoff, counting every one stood (a replayed round is a new standoff). */
  readonly standoff: number;
  /** The round being played (1 to 3); a round nobody took is played again under the same number. */
  readonly round: number;
  /** Rounds won by each seat: the first to ROUNDS_TO_WIN takes the match. */
  readonly score: readonly [number, number];
  /** When this standoff's countdown began (ms since the epoch). */
  readonly countAt: number;
  /** When the countdown ends and the standoff begins: touches before it change nothing. */
  readonly startedAt: number;
  /** When the sign flips to DRAW: 2–6 s after the standoff began, from the seed and the standoff. */
  readonly drawAt: number;
  /** The fake signs shown during the wait, in time order: never tap on these. */
  readonly decoys: readonly Decoy[];
  /** Each seat's tap: when the seated player's chip touched the reader, or null. */
  readonly taps: readonly [number | null, number | null];
  /** A chip that touched a seat's reader and is still being read (who it is isn't known yet): its touch time. */
  readonly pending: readonly [number | null, number | null];
  /** When phase is `round`: who took the round (null: nobody). When `done`: who took the match (null: a draw). */
  readonly winner: DuelSeat | null;
  /** Who took the last standoff, from `round` on (null: nobody, or none decided yet). */
  readonly took: DuelSeat | null;
  /** How the last standoff ended, from `round` on; null before. */
  readonly reason: QuickDrawReason | null;
  /** When the last standoff was decided, from `round` on; null before. */
  readonly decidedAt: number | null;
}

/**
 * `at` is when the chip touched the reader; `now` is when the Box hears of it. Judging is by `at` alone, never by
 * the order events arrive in.
 */
export type QuickDrawEvent =
  | { readonly type: "tick"; readonly now: number }
  /** A chip touched a seat's reader; whose it is comes later (a `tap`, or a `release`). */
  | { readonly type: "touch"; readonly seat: DuelSeat; readonly at: number; readonly now: number }
  /** The seated player's chip touched a seat's reader at `at`. */
  | { readonly type: "tap"; readonly seat: DuelSeat; readonly at: number; readonly now: number }
  /** The touch at a seat doesn't count: it wasn't the seated player's chip, or it couldn't be read. */
  | { readonly type: "release"; readonly seat: DuelSeat; readonly now: number };
