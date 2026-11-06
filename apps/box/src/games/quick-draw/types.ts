// Quick Draw's state and events. The rules (rules.ts) are pure: time and seeds arrive in events.
import type { Seat } from "@egb/sdk";

export type QuickDrawPhase = "wait" | "draw" | "done";

export interface QuickDrawState {
  readonly phase: QuickDrawPhase;
  /** When the standoff began (ms since the epoch). */
  readonly startedAt: number;
  /** When the sign flips to DRAW: 2–6 s after the start, from the seed. */
  readonly drawAt: number;
  /** Each seat's first tap time, or null. */
  readonly taps: readonly [number | null, number | null];
  readonly winner: Seat | null;
  /** `first`: the winner tapped first after the draw. `early`: the loser tapped before it. */
  readonly reason: "first" | "early" | null;
}

export type QuickDrawEvent =
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "tap"; readonly seat: Seat; readonly now: number };
