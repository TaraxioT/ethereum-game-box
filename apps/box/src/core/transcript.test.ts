import { describe, expect, it } from "vitest";
import { counts, FREE_MIN_MATCH_MS, FREE_PER_PAIR_HOUR, transcriptOf, type MatchRecord } from "./transcript.ts";

const END = 10_000_000;
const record: MatchRecord = {
  match: 3, game: "stock-duel", seed: 99, badges: ["0xa", "0xb"], stake: 10, startedAt: END - 30_000, endedAt: END,
  taps: [{ seat: 1, at: END - 5_000, roll: 42, accepted: true }], winner: 1, voided: false, seen: [END - 40_000, END - 39_000],
};
const none = { countedSince: () => 0 };

describe("whether a result counts", () => {
  it("needs both seated badges' station taps", () => {
    expect(counts(record, none)).toBe(true);
    expect(counts({ ...record, seen: [END - 40_000, null] }, none)).toBe(false);
  });

  it("needs every player's, however many played", () => {
    const three = { ...record, badges: ["0xa", "0xb", "0xc"], seen: [END - 40_000, END - 39_000, END - 38_000] };
    expect(counts(three, none)).toBe(true);
    expect(counts({ ...three, seen: [END - 40_000, END - 39_000, null] }, none)).toBe(false);
  });

  it("needs FREE_MIN_MATCH_MS since the first of them", () => {
    expect(counts({ ...record, seen: [END - FREE_MIN_MATCH_MS, END - 1_000] }, none)).toBe(true);
    expect(counts({ ...record, seen: [END - FREE_MIN_MATCH_MS + 1, END - 1_000] }, none)).toBe(false);
  });

  it("caps a pair at FREE_PER_PAIR_HOUR counted results in the hour before", () => {
    let since = 0;
    const log = { countedSince: (_: readonly [string, string], from: number) => ((since = from), FREE_PER_PAIR_HOUR) };
    expect(counts(record, log)).toBe(false);
    expect(since).toBe(END - 3_600_000);
    expect(counts(record, { countedSince: () => FREE_PER_PAIR_HOUR - 1 })).toBe(true);
  });
});

describe("the transcript", () => {
  it("is the match as the session log keeps it", () => {
    expect(transcriptOf(record, none)).toEqual({
      v: 1, match: 3, game: "stock-duel", seed: 99, badges: ["0xa", "0xb"], stake: 10, startedAt: END - 30_000, endedAt: END,
      taps: record.taps, result: { winner: 1 }, counts: true,
    });
  });
});
