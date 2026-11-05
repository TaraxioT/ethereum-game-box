// What every game's rules module provides. Rules are pure: `(state, event) → state`, with time and seeds in events.
import type { Seat } from "./seat.ts";

/** How a finished game ended: a winner, or null for a draw (both stakes go back). */
export interface Outcome {
  readonly winner: Seat | null;
}

export interface GameRules<S, E> {
  /** A new game from a seed (uint32) at `now` (ms since the epoch). */
  start(seed: number, now: number): S;
  step(state: S, event: E): S;
  /** null while the game runs. */
  outcome(state: S): Outcome | null;
}
