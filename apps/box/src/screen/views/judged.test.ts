import { describe, expect, it } from "vitest";
import type { Judged } from "../../core/types.ts";
import { judgingWords, splitWords } from "./judged.ts";

const said = (step: Judged["step"], over: Partial<Judged> = {}): Judged => ({ step, payouts: null, hash: null, etherscan: null, reason: null, ...over });

describe("the verifier's word on screen", () => {
  it("says the judge is working, then what is on its way", () => {
    expect(judgingWords(null).head).toBe("JUDGING");
    expect(judgingWords(said("judging")).head).toBe("JUDGING");
    expect(judgingWords(said("paying", { payouts: [15, 5] }))).toEqual({ head: "PAYING", detail: "THE VERDICT STANDS · ITS SPLIT IS GOING TO SEPOLIA" });
    expect(judgingWords(said("paying"))).toEqual({ head: "PAYING", detail: "EVERY STAKE IS GOING BACK ON SEPOLIA" });
  });

  it("shows each seat's share of a split against its stake", () => {
    expect(splitWords(said("paid", { payouts: [15.5, 4.5] }), 10, ["nova.gamebox.eth", null])).toEqual({
      banner: "THE JUDGE SPLIT THE POT",
      seats: [
        { status: "+15.5 USDC", tone: "win" },
        { status: "+4.5 USDC", tone: "lose" },
      ],
      lines: ["nova.gamebox.eth +15.5 USDC", "Player 2 +4.5 USDC"],
    });
    expect(splitWords(said("paid", { payouts: [10, 10] }), 10, ["a", "b"]).seats.map((s) => s.tone)).toEqual(["done", "done"]);
    expect(splitWords(said("paid", { payouts: [20, 0] }), 10, ["a", "b"]).seats[1]).toEqual({ status: "+0 USDC", tone: "lose" });
  });

  it("leaves a split of more than two to the players' panels", () => {
    const words = splitWords(said("paid", { payouts: [25, 5, 5, 5] }), 10, ["a", "b", "c", "d"]);
    expect(words.seats.map((s) => [s.status, s.tone])).toEqual([["+25 USDC", "win"], ["+5 USDC", "lose"], ["+5 USDC", "lose"], ["+5 USDC", "lose"]]);
    expect(words.lines).toEqual([]);
  });

  it("shows a refund as a refund, with why", () => {
    const words = splitWords(said("refunded", { reason: "the agent couldn't judge" }), 10, ["a", "b"]);
    expect(words).toEqual({
      banner: "REFUNDED · EVERY STAKE WENT BACK",
      seats: [
        { status: "REFUNDED · 10 USDC BACK", tone: "done" },
        { status: "REFUNDED · 10 USDC BACK", tone: "done" },
      ],
      lines: ["the agent couldn't judge"],
    });
    expect(splitWords(said("refunded"), 5, ["a", "b"]).lines).toEqual([]);
  });
});
