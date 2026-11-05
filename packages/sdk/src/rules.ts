// What every game's rules module provides. Rules are pure: `(state, event) → state`, with time and seeds in events.
import type { Seat } from "./seat.ts";
import type { StationView } from "./station.ts";

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

/**
 * The events a built game's rules get. `tap` is a finished tap (`done`): `now` is when the chip touched the reader,
 * never when its answer arrived, and `roll` is the badge's verified number when the game's taps are `random`.
 */
export type BuiltEvent =
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "tap"; readonly seat: Seat; readonly now: number; readonly roll: number | null };

/** A built game's rules module: pure rules plus what each station shows. */
export interface BuiltRules<S> extends GameRules<S, BuiltEvent> {
  stations(state: S): readonly [StationView, StationView];
}
