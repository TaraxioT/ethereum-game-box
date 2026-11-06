// The Box's match log against the checks the verifier runs on it: whatever a game posts and however long the players
// tap, what the core hands over is a log the verifier will read.
import { describe, expect, it } from "vitest";
import { LOG_LIMITS, logProblems, type MatchLog } from "@egb/sdk";
import { createStoreLog } from "./store-log.ts";

const AT = 1_790_000_000_000;

const whole = (entries: MatchLog["entries"]): MatchLog => ({
  header: {
    v: 1,
    box: "mumbai-01",
    round: "7",
    bundle: `0x${"ab".repeat(32)}`,
    game: "tap-rush",
    players: [`0x${"a1".repeat(20)}`, `0x${"b2".repeat(20)}`],
    amount: "10000000",
    startedAt: AT,
  },
  entries,
});

/** The heaviest event the kiosk's gate lets through. */
const heavy = "é".repeat(LOG_LIMITS.eventDataBytes / 2 - 1);

describe("a store match's log", () => {
  it("labels the Box's taps and the game's claims, and closes with its one end", () => {
    const log = createStoreLog();
    log.tap(1, AT + 0.25, 4_294_967_295);
    log.event("score", { seat: 1 }, AT + 1);
    const entries = log.close("game", AT + 2);
    expect(entries).toEqual([
      { src: "box", t: "tap", seat: 1, at: AT + 0.25, roll: 4_294_967_295 },
      { src: "game", t: "event", at: AT + 1, name: "score", data: { seat: 1 } },
      { src: "box", t: "end", at: AT + 2, why: "game" },
    ]);
    expect(logProblems(whole(entries))).toEqual([]);
  });

  it("holds game events to half the entries, so they can't crowd out the taps", () => {
    const log = createStoreLog();
    for (let i = 0; i < LOG_LIMITS.entries; i++) log.event("spam", i, AT);
    expect(log.full()).toBe(false);
    const taps = LOG_LIMITS.entries / 2 - 1;
    for (let i = 0; i < taps; i++) log.tap(0, AT, null);
    expect(log.full()).toBe(true);
    const entries = log.close("time", AT);
    expect(entries.filter((e) => e.src === "game")).toHaveLength(LOG_LIMITS.entries / 2);
    expect(entries.filter((e) => e.t === "tap")).toHaveLength(taps);
    expect(logProblems(whole(entries))).toEqual([]);
  });

  it("holds game events to half the bytes, and the fullest log is still one the verifier reads", () => {
    const log = createStoreLog();
    for (let i = 0; i < LOG_LIMITS.entries; i++) log.event("n".repeat(LOG_LIMITS.eventName), heavy, AT);
    let taps = 0;
    while (!log.full()) {
      log.tap(1, AT + 0.123456, 4_294_967_295);
      taps++;
    }
    const entries = log.close("time", AT);
    expect(entries).toHaveLength(LOG_LIMITS.entries);
    expect(taps).toBeGreaterThan(LOG_LIMITS.entries / 2);
    expect(logProblems(whole(entries))).toEqual([]);
  });
});
