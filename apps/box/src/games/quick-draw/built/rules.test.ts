// Quick Draw's built rules: judged by touch time, settled for the other station, false starts, dead heats, and an
// end to every match.
import { describe, expect, it } from "vitest";
import type { BuiltEvent, Seat } from "@egb/sdk";
import rules, { MAX_WAIT_MS, MIN_WAIT_MS, reactionMs, SETTLE_MS, STANDOFFS, TOO_SLOW_MS, type QuickDrawState } from "./rules.ts";

const T0 = 1_000_000;
const tick = (now: number): BuiltEvent => ({ type: "tick", now });
const tap = (seat: Seat, now: number): BuiltEvent => ({ type: "tap", seat, now, roll: null });
const run = (state: QuickDrawState, ...events: BuiltEvent[]) => events.reduce(rules.step, state);

describe("Quick Draw's built rules", () => {
  it("turns the sign 2–6 s in, from the seed alone", () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = rules.start(seed, T0);
      expect(s.drawAt - T0).toBeGreaterThanOrEqual(MIN_WAIT_MS);
      expect(s.drawAt - T0).toBeLessThanOrEqual(MAX_WAIT_MS);
      expect(rules.start(seed, T0)).toEqual(s);
    }
    const s = rules.start(7, T0);
    expect(rules.step(s, tick(s.drawAt - 1)).phase).toBe("wait");
    expect(rules.step(s, tick(s.drawAt)).phase).toBe("draw");
    expect(rules.stations(rules.step(s, tick(s.drawAt))).map((v) => v.big)).toEqual(["DRAW!", "DRAW!"]);
  });

  it("gives a good tap the settle wait, and lets an earlier touch arriving late win", () => {
    const s = rules.start(7, T0);
    const first = run(s, tick(s.drawAt), tap(1, s.drawAt + 300));
    expect(first.phase).toBe("draw");
    expect(rules.outcome(first)).toBeNull();
    // Player 1 touched at +250 but its tap reached the Box after Player 2's.
    const late = rules.step(first, tap(0, s.drawAt + 250));
    expect(rules.outcome(late)).toEqual({ winner: 0 });
    expect(reactionMs(late, 0)).toBe(250);
    expect(rules.stations(late).map((v) => [v.big, v.small])).toEqual([["WIN", "250 ms"], ["LOSE", "300 ms"]]);
    // Alone, a good tap wins once its settle wait is over.
    expect(rules.outcome(rules.step(first, tick(s.drawAt + 300 + SETTLE_MS - 1)))).toBeNull();
    expect(rules.outcome(rules.step(first, tick(s.drawAt + 300 + SETTLE_MS)))).toEqual({ winner: 1 });
  });

  it("loses a false start at once, and calls a dead heat a draw", () => {
    const s = rules.start(7, T0);
    const early = rules.step(s, tap(0, s.drawAt - 1));
    expect(early).toMatchObject({ phase: "done", winner: 1, reason: "early" });
    expect(rules.stations(early)[0]).toMatchObject({ big: "LOSE", small: "too early" });
    const heat = run(s, tap(0, s.drawAt + 100), tap(1, s.drawAt + 100));
    expect(rules.outcome(heat)).toEqual({ winner: null });
  });

  it("ignores touches from before the standoff and second taps", () => {
    const s = rules.start(7, T0);
    expect(rules.step(s, tap(0, T0 - 1)).taps).toEqual([null, null]);
    const once = run(s, tick(s.drawAt), tap(0, s.drawAt + 200));
    expect(rules.step(once, tap(0, s.drawAt + 100)).taps).toEqual([s.drawAt + 200, null]);
  });

  it("stands the standoff again when nobody draws, and ends in a draw after the last", () => {
    let s = rules.start(7, T0);
    for (let n = 1; n < STANDOFFS; n++) {
      s = run(s, tick(s.drawAt), tick(s.drawAt + TOO_SLOW_MS));
      expect(s).toMatchObject({ phase: "wait", standoff: n + 1 });
    }
    s = run(s, tick(s.drawAt), tick(s.drawAt + TOO_SLOW_MS));
    expect(s).toMatchObject({ phase: "done", winner: null, reason: "slow" });
    expect(rules.stations(s).map((v) => v.big)).toEqual(["TIE", "TIE"]);
  });
});
