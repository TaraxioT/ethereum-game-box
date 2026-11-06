import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, MIN_WAIT_MS, reactionMs, rules } from "./rules.ts";
import type { QuickDrawState } from "./types.ts";

const T0 = 1_000_000;

function drawn(seed = 1): QuickDrawState {
  const start = rules.start(seed, T0);
  return rules.step(start, { type: "tick", now: start.drawAt });
}

describe("start", () => {
  it("waits, with the draw 2 to 6 seconds out for every seed", () => {
    for (let seed = 0; seed < 5000; seed++) {
      const state = rules.start(seed, T0);
      expect(state.phase).toBe("wait");
      expect(state.startedAt).toBe(T0);
      expect(state.drawAt - T0).toBeGreaterThanOrEqual(MIN_WAIT_MS);
      expect(state.drawAt - T0).toBeLessThanOrEqual(MAX_WAIT_MS);
      expect(state.taps).toEqual([null, null]);
      expect(rules.outcome(state)).toBeNull();
    }
  });

  it("repeats for a seed and varies between seeds", () => {
    expect(rules.start(7, T0)).toEqual(rules.start(7, T0));
    const waits = new Set(Array.from({ length: 50 }, (_, seed) => rules.start(seed, T0).drawAt));
    expect(waits.size).toBeGreaterThan(30);
  });
});

describe("tick", () => {
  it("stays in wait before the draw and flips at it", () => {
    const start = rules.start(3, T0);
    expect(rules.step(start, { type: "tick", now: start.drawAt - 1 }).phase).toBe("wait");
    expect(rules.step(start, { type: "tick", now: start.drawAt }).phase).toBe("draw");
    expect(rules.step(start, { type: "tick", now: start.drawAt + 900 }).phase).toBe("draw");
  });
});

describe("taps", () => {
  it("an early tap loses: the other seat wins", () => {
    const start = rules.start(3, T0);
    const early = rules.step(start, { type: "tap", seat: 0, now: start.drawAt - 10 });
    expect(early.phase).toBe("done");
    expect(early.reason).toBe("early");
    expect(rules.outcome(early)).toEqual({ winner: 1 });
    const early1 = rules.step(start, { type: "tap", seat: 1, now: T0 + 1 });
    expect(rules.outcome(early1)).toEqual({ winner: 0 });
  });

  it("the first tap after the draw wins", () => {
    const state = drawn();
    const won = rules.step(state, { type: "tap", seat: 1, now: state.drawAt + 240 });
    expect(won.reason).toBe("first");
    expect(rules.outcome(won)).toEqual({ winner: 1 });
    expect(reactionMs(won, 1)).toBe(240);
    expect(reactionMs(won, 0)).toBeNull();
  });

  it("a tap at the draw time counts even when no tick came first", () => {
    const start = rules.start(3, T0);
    const won = rules.step(start, { type: "tap", seat: 0, now: start.drawAt + 5 });
    expect(won.reason).toBe("first");
    expect(rules.outcome(won)).toEqual({ winner: 0 });
    expect(reactionMs(won, 0)).toBe(5);
  });

  it("simultaneous taps go to whichever event comes first", () => {
    const state = drawn();
    const at = state.drawAt + 100;
    const a = rules.step(rules.step(state, { type: "tap", seat: 0, now: at }), { type: "tap", seat: 1, now: at });
    const b = rules.step(rules.step(state, { type: "tap", seat: 1, now: at }), { type: "tap", seat: 0, now: at });
    expect(rules.outcome(a)).toEqual({ winner: 0 });
    expect(rules.outcome(b)).toEqual({ winner: 1 });
  });

  it("ignores everything after the game is done", () => {
    const state = drawn();
    const done = rules.step(state, { type: "tap", seat: 0, now: state.drawAt + 100 });
    expect(rules.step(done, { type: "tap", seat: 1, now: state.drawAt + 150 })).toBe(done);
    expect(rules.step(done, { type: "tick", now: state.drawAt + 5000 })).toBe(done);
    const early = rules.step(rules.start(2, T0), { type: "tap", seat: 0, now: T0 + 1 });
    expect(rules.step(early, { type: "tap", seat: 1, now: early.drawAt + 10 })).toBe(early);
    expect(reactionMs(early, 0)).toBeNull();
  });
});

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const start = Object.freeze(rules.start(4, T0));
    const frozen = { ...start, taps: Object.freeze([...start.taps]) as unknown as QuickDrawState["taps"] };
    const snapshot = structuredClone(frozen);
    rules.step(frozen, { type: "tick", now: frozen.drawAt });
    rules.step(frozen, { type: "tap", seat: 0, now: frozen.drawAt - 1 });
    rules.step(frozen, { type: "tap", seat: 1, now: frozen.drawAt + 1 });
    expect(frozen).toEqual(snapshot);
  });
});
