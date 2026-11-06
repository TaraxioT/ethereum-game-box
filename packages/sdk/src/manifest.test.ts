import { describe, expect, it } from "vitest";
import { manifestProblems } from "./manifest.ts";

const game = { id: "quick-draw", title: "Quick Draw", blurb: "Fastest tap wins.", players: 2, minutes: 1, stakes: [5, 10, 25], tier: "refereed", taps: "identify", kind: "team", budgetMs: 200 };

describe("manifestProblems", () => {
  it("takes a good game.json", () => {
    expect(manifestProblems(game)).toEqual([]);
  });

  it("takes a typical match of under a minute, so no built game drops off the rack", () => {
    expect(manifestProblems({ ...game, minutes: 0.5 })).toEqual([]);
  });

  it.each([0, -1, 31, "1", undefined])("refuses minutes of %j, and says what it wants", (minutes) => {
    expect(manifestProblems({ ...game, minutes })).toEqual(["minutes must be above 0, at most 30"]);
  });
});
