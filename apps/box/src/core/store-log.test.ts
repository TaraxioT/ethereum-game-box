// The Box's match log against the checks the verifier runs on it: whatever a game posts and however long the players
// tap, what the core hands over is a log the verifier will read.
import { describe, expect, it } from "vitest";
import { LOG_LIMITS, logProblems, mulberry32, type MatchLog } from "@egb/sdk";
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

  it("leaves room for the tap that fills the log when an event lands just before it", () => {
    const log = createStoreLog();
    const half = LOG_LIMITS.entries / 2;
    for (let i = 0; i < half - 1; i++) {
      log.tap(0, AT, null);
      log.event("score", i, AT);
    }
    expect(log.full()).toBe(false);
    log.event("score", "the last of its budget", AT);
    log.tap(0, AT, null);
    expect(log.full()).toBe(true);
    const entries = log.close("time", AT);
    expect(entries).toHaveLength(LOG_LIMITS.entries);
    expect(entries.filter((e) => e.t === "tap")).toHaveLength(half);
    expect(logProblems(whole(entries))).toEqual([]);
  });

  it("stops a game spending its held-back events past the limit once the taps are near it", () => {
    const log = createStoreLog();
    const taps = LOG_LIMITS.entries / 2 + 100;
    for (let i = 0; i < taps; i++) log.tap(1, AT, null);
    for (let i = 0; i < LOG_LIMITS.entries / 2; i++) log.event("late", i, AT);
    expect(log.full()).toBe(false);
    const entries = log.close("game", AT);
    // Room stayed for one more tap, which the game's close didn't need.
    expect(entries).toHaveLength(LOG_LIMITS.entries - 1);
    expect(entries.filter((e) => e.t === "tap")).toHaveLength(taps);
    expect(logProblems(whole(entries))).toEqual([]);
  });

  it("keeps every order of taps and events within the limit, asked only after a tap as the core asks", () => {
    const random = mulberry32(11);
    for (let run = 0; run < 20; run++) {
      const log = createStoreLog();
      const tapShare = 0.1 + 0.8 * random();
      let open = true;
      while (open) {
        if (random() < tapShare) {
          log.tap(0, AT, null);
          open = !log.full();
        } else log.event("score", run, AT);
      }
      expect(logProblems(whole(log.close("time", AT)))).toEqual([]);
    }
  });
});
