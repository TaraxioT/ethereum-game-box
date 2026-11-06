// A championship's records read as values: integers, and the standings JSON `Championships` writes. Anything else
// reads as null, never as a guess.
import { describe, expect, it } from "vitest";

import { readStandings, recordInt } from "./cups.ts";

describe("a championship's records", () => {
  it("reads ends and prize as integers, and anything else as null", () => {
    expect(recordInt("1762430400")).toBe(1_762_430_400n);
    expect(recordInt("100000000")).toBe(100_000_000n);
    expect(recordInt(null)).toBeNull();
    expect(recordInt("")).toBeNull();
    expect(recordInt("-5")).toBeNull();
    expect(recordInt("1e6")).toBeNull();
  });

  it("reads the standings in rank order, and a malformed record as null", () => {
    const text = JSON.stringify([
      { name: "nova.gamebox.eth", addr: "0x7a11000000000000000000000000000000000b0b", points: 6, wins: 2, draws: 0, losses: 1 },
      { name: "kite.gamebox.eth", addr: "0x5e1d000000000000000000000000000000000a11", points: 3, wins: 1, draws: 0, losses: 2 },
    ]);
    expect(readStandings(text)?.map((s) => [s.name, s.points])).toEqual([
      ["nova.gamebox.eth", 6],
      ["kite.gamebox.eth", 3],
    ]);
    expect(readStandings("[]")).toEqual([]);
    expect(readStandings(null)).toBeNull();
    expect(readStandings("{not json")).toBeNull();
    expect(readStandings('[{"name":"nova.gamebox.eth"}]')).toBeNull();
  });
});
