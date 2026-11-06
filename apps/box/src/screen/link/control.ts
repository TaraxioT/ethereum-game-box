// The simulated Box's hardware side: what the drawn tap stations, the badges and the DEMO plate drive. It is not
// part of BoxLink: on a real Box, taps come from the stations and nobody can cut the power from the screen.
import type { Opponent } from "../../core/core.ts";
import type { Badge, BoxLink, Seat } from "../../core/types.ts";

export type { Opponent };

export interface SimControl {
  /** The badges lying on the desk, plus the bot's. */
  readonly badges: readonly Badge[];
  readonly botBadge: Badge;
  /**
   * A badge taps a seat's station. Without a badge, the seat's seated badge taps, or, on an empty seat, the next
   * badge on the desk that isn't seated. With the bot playing, taps on its seat (Player 2) are ignored.
   */
  tap(seat: Seat, badge?: Badge): void;
  opponent(): Opponent;
  setOpponent(opponent: Opponent): void;
  /** Off: the Box can't settle the match it is running, so it goes to Refund when the game ends. */
  power(): boolean;
  setPower(on: boolean): void;
  /** Stops the clock and every timer (tests, page unload). */
  stop(): void;
}

export type SimLink = BoxLink & SimControl;
