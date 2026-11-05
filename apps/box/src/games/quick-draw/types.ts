// Quick Draw's state and events. The rules (rules.ts) are pure: time and seeds arrive in events.
import type { Seat } from "@egb/sdk";

export type QuickDrawPhase = "wait" | "draw" | "done";

export interface QuickDrawState {
  readonly phase: QuickDrawPhase;
  readonly seed: number;
  /** 1 for the first standoff; a standoff nobody drew in is stood again with the next number. */
  readonly standoff: number;
  /** When this standoff began (ms since the epoch). */
  readonly startedAt: number;
  /** When the sign flips to DRAW: 2–6 s after the standoff began, from the seed and the standoff. */
  readonly drawAt: number;
  /** Each seat's tap: when the seated player's chip touched the reader, or null. */
  readonly taps: readonly [number | null, number | null];
  /** A chip that touched a seat's reader and is still being read (who it is isn't known yet): its touch time. */
  readonly pending: readonly [number | null, number | null];
  /** Set when phase is `done`: null is a dead heat (both stakes go back). */
  readonly winner: Seat | null;
  /** `first`: the winner touched first after the draw. `early`: the loser touched before it. */
  readonly reason: "first" | "early" | null;
}

/**
 * `at` is when the chip touched the reader; `now` is when the Box hears of it. Judging is by `at` alone, never by
 * the order events arrive in.
 */
export type QuickDrawEvent =
  | { readonly type: "tick"; readonly now: number }
  /** A chip touched a seat's reader; whose it is comes later (a `tap`, or a `release`). */
  | { readonly type: "touch"; readonly seat: Seat; readonly at: number; readonly now: number }
  /** The seated player's chip touched a seat's reader at `at`. */
  | { readonly type: "tap"; readonly seat: Seat; readonly at: number; readonly now: number }
  /** The touch at a seat doesn't count: it wasn't the seated player's chip, or it couldn't be read. */
  | { readonly type: "release"; readonly seat: Seat; readonly now: number };
