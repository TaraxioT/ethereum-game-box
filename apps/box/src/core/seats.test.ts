import { describe, expect, it } from "vitest";
import { allSigned, playerSeats } from "./seats.ts";
import { DEMO_BADGES } from "./badges.ts";

const seated = (signed = false) => ({ badge: DEMO_BADGES[0] ?? null, signed });
const empty = { badge: null, signed: false };

describe("a match's players", () => {
  it("are the seats with a badge, in seat order", () => {
    expect(playerSeats([seated(), seated()])).toEqual([0, 1]);
    expect(playerSeats([seated(), empty, seated(), seated()])).toEqual([0, 2, 3]);
    expect(playerSeats([empty, empty])).toEqual([]);
  });

  it("have all signed when every badge has, whoever sits out", () => {
    expect(allSigned([seated(true), seated(true)])).toBe(true);
    expect(allSigned([seated(true), seated()])).toBe(false);
    expect(allSigned([seated(true), empty, seated(true), empty])).toBe(true);
    expect(allSigned([empty, empty])).toBe(false);
  });
});
