import { describe, expect, it } from "vitest";
import { allSigned, playerSeats, seatsInUse } from "./seats.ts";
import { DEMO_BADGES } from "./badges.ts";

const seated = (signed = false) => ({ badge: DEMO_BADGES[0] ?? null, signed });
const empty = { badge: null, signed: false };

describe("a match's players", () => {
  it("are the seats with a badge, in seat order", () => {
    expect(playerSeats([seated(), seated()])).toEqual([0, 1]);
    expect(playerSeats([seated(), empty, seated(), seated()])).toEqual([0, 2, 3]);
    expect(playerSeats([empty, empty])).toEqual([]);
  });

  it("need a station each from Stake on: before that, so does every seat on show", () => {
    const gap = [seated(), empty, seated(), empty];
    for (const phase of ["boot", "attract", "lobby", "build", "home", "join"] as const) expect(seatsInUse({ phase, seats: gap })).toEqual([0, 1, 2, 3]);
    for (const phase of ["stake", "playing", "judging", "result", "refund"] as const) expect(seatsInUse({ phase, seats: gap })).toEqual([0, 2]);
  });

  it("have all signed when every badge has, whoever sits out", () => {
    expect(allSigned([seated(true), seated(true)])).toBe(true);
    expect(allSigned([seated(true), seated()])).toBe(false);
    expect(allSigned([seated(true), empty, seated(true), empty])).toBe(true);
    expect(allSigned([empty, empty])).toBe(false);
  });
});
