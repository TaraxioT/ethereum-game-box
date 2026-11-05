// What the next tap at each seat should ask of the badge, from the Box's state. Pure. `identify`: who it is (the
// UID, from the roster). `random`: a verified roll from key 2, asked only when the game will use the number. `none`:
// the tap means nothing now; the badge is still identified (an unknown chip is always read).
import type { Seat } from "@egb/sdk";
import type { TapPlan } from "./ports.ts";
import type { BoxState, Match } from "./types.ts";

/** Everything a plan reads: the Box's state without the station views. */
export type PlanInput = Omit<BoxState, "stations">;

function gamePlan(match: Match | null, seat: Seat): TapPlan {
  if (!match || match.outcome) return "none";
  const { play } = match;
  // Quick Draw judges by the touch: who touched, and when.
  if (play.game === "quick-draw") return play.state.phase !== "done" && play.state.taps[seat] === null ? "identify" : "none";
  // Stock Duel's tap plays a card, and its roll picks the stat.
  return play.state.phase === "pick" && play.state.played[seat] === null ? "random" : "none";
}

export function tapPlan(state: PlanInput, seat: Seat): TapPlan {
  const mine = state.seats[seat];
  switch (state.phase) {
    case "boot":
    case "result":
      return "none";
    case "attract":
    case "home":
    case "join":
      return "identify";
    case "stake":
      return mine.badge && !mine.signed ? "identify" : "none";
    case "playing":
      return mine.badge ? gamePlan(state.match, seat) : "none";
    case "refund": {
      const { match } = state;
      const open = match !== null && !match.refunded[seat] && state.chain.block >= match.refundBlock;
      return mine.badge && open ? "identify" : "none";
    }
  }
}
