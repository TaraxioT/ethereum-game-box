// What the verifier's word on a store match looks like on screen: JUDGING's plate while it works, and Result's banner,
// seats and lines once the pot has gone out. Pure, so it is tested without a DOM. The split comes from the verifier, and
// what it pays is on chain: the Box adds nothing to it.
import type { Judged } from "../../core/types.ts";
import type { SeatTone } from "./seat-panel.ts";

export interface JudgingWords {
  readonly head: string;
  readonly detail: string;
}

/** JUDGING's plate: the agent at work, then the verdict on its way to Sepolia. */
export function judgingWords(judged: Judged | null): JudgingWords {
  if (judged?.step === "paying") return { head: "PAYING", detail: judged.payouts ? "THE VERDICT STANDS · ITS SPLIT IS GOING TO SEPOLIA" : "EVERY STAKE IS GOING BACK ON SEPOLIA" };
  return { head: "JUDGING", detail: "AN AI JUDGE IS READING THE MATCH'S LOG" };
}

export interface SplitWords {
  readonly banner: string;
  readonly seats: readonly { readonly status: string; readonly tone: SeatTone }[];
  readonly lines: readonly string[];
}

/** Result's words for a store match: each seat's share against its `stake`, or every stake back with why. */
export function splitWords(judged: Judged | null, stake: number, names: readonly (string | null)[]): SplitWords {
  if (judged?.step === "refunded") {
    return { banner: "REFUNDED · EVERY STAKE WENT BACK", seats: names.map(() => ({ status: `REFUNDED · ${stake} USDC BACK`, tone: "done" })), lines: judged.reason ? [judged.reason] : [] };
  }
  const paid = names.map((_, seat) => judged?.payouts?.[seat] ?? 0);
  return {
    banner: "THE JUDGE SPLIT THE POT",
    seats: paid.map((share) => ({ status: `+${share} USDC`, tone: share > stake ? "win" : share < stake ? "lose" : "done" })),
    lines: paid.map((share, seat) => `${names[seat] ?? `Player ${seat + 1}`} +${share} USDC`),
  };
}
