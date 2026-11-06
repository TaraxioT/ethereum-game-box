// Join's plate, and whether its START key is lit. Pure, so it is tested without a DOM. A team game needs every seat, and
// moves on by itself; a store game can start with fewer, once enough have sat down and its bundle is here.
import type { BoxState } from "../../core/types.ts";

export interface JoinWords {
  readonly plate: string;
  /** START works now. */
  readonly ready: boolean;
}

/** How many badges a tap is still wanted from, in words. */
function wanted(count: number, seats: number): string {
  if (count === 1) return "A BADGE";
  return count === seats && seats === 2 ? "BOTH BADGES" : `${count} BADGES`;
}

export function joinWords(state: Pick<BoxState, "seats" | "fewest" | "fetching">, title: string): JoinWords {
  const seats = state.seats.length;
  const seated = state.seats.filter((seat) => seat.badge).length;
  if (seated < state.fewest) return { plate: `${title} · TAP ${wanted(state.fewest - seated, seats)} TO JOIN`, ready: false };
  if (state.fetching) return { plate: "DOWNLOADING THE GAME…", ready: false };
  if (seated === seats) return { plate: seats === 2 ? "BOTH SEATED" : "ALL SEATED", ready: true };
  return { plate: `${seated} SEATED · TAP TO JOIN, OR START`, ready: true };
}
