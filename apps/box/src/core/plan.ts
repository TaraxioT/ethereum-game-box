// What the next tap at each seat should ask of the badge, from the Box's state. Pure. `identify`: who it is (the
// UID, from the roster). `random`: a verified roll from key 2, asked only when the game will use the number. `none`:
// the tap means nothing now; the badge is still identified (an unknown chip is always read).
//
// On the result, a seated badge's tap is a rematch, but only REMATCH_TAP_MS after the game ended: a chip left on the
// reader, or slammed down a moment late, mustn't skip the result.
import type { Seat } from "@egb/sdk";
import type { TapPlan } from "./ports.ts";
import type { BoxState, Match } from "./types.ts";

/** Everything a plan reads: the Box's state without the station views. */
export type PlanInput = Omit<BoxState, "stations">;

/** After a game ends, a seated badge's tap is a rematch only this long after. */
export const REMATCH_TAP_MS = 4_000;

function gamePlan(state: PlanInput, match: Match | null, seat: Seat): TapPlan {
  if (!match || match.outcome) return "none";
  const { play } = match;
  // A built game's rules decide what a tap means: every tap asks what its game.json says.
  if (play.game === "built") return state.games.find((g) => g.id === play.id)?.manifest?.taps ?? "identify";
  // A store game's bundle says, in its manifest.
  if (play.game === "store") return play.taps;
  // Quick Draw judges by the touch: who touched, and when.
  if (play.game === "quick-draw") return play.state.phase !== "done" && play.state.taps[seat] === null ? "identify" : "none";
  // Stock Duel's tap plays a card, and its roll picks the stat.
  return play.state.phase === "pick" && play.state.played[seat] === null ? "random" : "none";
}

export function tapPlan(state: PlanInput, seat: Seat, now: number): TapPlan {
  const mine = state.seats[seat];
  switch (state.phase) {
    case "boot":
    case "build":
    case "judging":
      return "none";
    case "result": {
      const endedAt = state.match?.endedAt ?? null;
      return mine.badge && endedAt !== null && now - endedAt >= REMATCH_TAP_MS ? "identify" : "none";
    }
    case "attract":
    case "home":
    case "join":
    case "lobby":
      return "identify";
    case "stake":
      return mine.badge && !mine.signed ? "identify" : "none";
    case "playing":
      return mine.badge ? gamePlan(state, state.match, seat) : "none";
    case "refund": {
      const { match } = state;
      const open = match !== null && !match.refunded[seat] && now >= match.refundAt;
      return mine.badge && open ? "identify" : "none";
    }
  }
}
