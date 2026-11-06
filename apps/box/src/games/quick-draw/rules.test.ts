import { describe, expect, it } from "vitest";
import type { DuelSeat } from "@egb/sdk";
import { MAX_WAIT_MS, MIN_WAIT_MS, READ_WAIT_MS, reactionMs, rules, SETTLE_MS, TOO_SLOW_MS } from "./rules.ts";
import type { QuickDrawState } from "./types.ts";

const T0 = 1_000_000;

function drawn(seed = 1): QuickDrawState {
  const start = rules.start(seed, T0);
  return rules.step(start, { type: "tick", now: start.drawAt });
}

/** The seated player's chip touched at `at`; the Box hears of it at `now` (just after, by default). */
const tap = (state: QuickDrawState, seat: DuelSeat, at: number, now = at + 5) => rules.step(state, { type: "tap", seat, at, now });
const tick = (state: QuickDrawState, now: number) => rules.step(state, { type: "tick", now });

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
    expect(tick(start, start.drawAt - 1).phase).toBe("wait");
    expect(tick(start, start.drawAt).phase).toBe("draw");
    expect(tick(start, start.drawAt + 900).phase).toBe("draw");
  });

  it("stands the standoff again when nobody touches within TOO_SLOW_MS of the draw, with a new draw time", () => {
    const state = drawn(5);
    expect(tick(state, state.drawAt + TOO_SLOW_MS - 1)).toMatchObject({ phase: "draw", standoff: 1 });
    const again = tick(state, state.drawAt + TOO_SLOW_MS);
    expect(again).toMatchObject({ phase: "wait", standoff: 2, startedAt: state.drawAt + TOO_SLOW_MS, taps: [null, null] });
    expect(again.drawAt - again.startedAt).toBeGreaterThanOrEqual(MIN_WAIT_MS);
    expect(again.drawAt - again.startedAt).toBeLessThanOrEqual(MAX_WAIT_MS);
    expect(rules.outcome(again)).toBeNull();
    // A touch from the last standoff doesn't count in this one.
    expect(tap(again, 0, state.drawAt + 100, again.startedAt + 10)).toEqual(again);
  });
});

describe("judging by touch time", () => {
  it("a touch before the draw loses at once: the other seat wins", () => {
    const start = rules.start(3, T0);
    const early = tap(start, 0, start.drawAt - 10);
    expect(early).toMatchObject({ phase: "done", reason: "early" });
    expect(rules.outcome(early)).toEqual({ winner: 1 });
    expect(rules.outcome(tap(start, 1, T0 + 1))).toEqual({ winner: 0 });
  });

  it("judges an early touch by its time, even when the Box hears of it after the flip", () => {
    const state = drawn(4);
    const early = tap(state, 1, state.drawAt - 3, state.drawAt + 20);
    expect(early.reason).toBe("early");
    expect(rules.outcome(early)).toEqual({ winner: 0 });
  });

  it("a good tap waits SETTLE_MS from its touch for the other station, then wins", () => {
    const state = drawn();
    const one = tap(state, 1, state.drawAt + 240);
    expect(one.phase).toBe("draw");
    expect(tick(one, state.drawAt + 240 + SETTLE_MS - 1).phase).toBe("draw");
    const won = tick(one, state.drawAt + 240 + SETTLE_MS);
    expect(won).toMatchObject({ phase: "done", reason: "first" });
    expect(rules.outcome(won)).toEqual({ winner: 1 });
    expect(reactionMs(won, 1)).toBe(240);
    expect(reactionMs(won, 0)).toBeNull();
  });

  it("the earlier touch wins, whichever the Box heard first", () => {
    const state = drawn();
    const later = tap(state, 0, state.drawAt + 300, state.drawAt + 305);
    const both = tap(later, 1, state.drawAt + 280, state.drawAt + 330);
    expect(rules.outcome(both)).toEqual({ winner: 1 });
    expect([reactionMs(both, 0), reactionMs(both, 1)]).toEqual([300, 280]);
  });

  it("waits for a chip still being read that touched earlier, at most READ_WAIT_MS", () => {
    const state = drawn(2);
    const reading = rules.step(state, { type: "touch", seat: 0, at: state.drawAt + 100, now: state.drawAt + 105 });
    const tapped = tap(reading, 1, state.drawAt + 200);
    expect(tick(tapped, state.drawAt + 1000).phase).toBe("draw");
    // Its read comes back: it was the seated player's chip, and it was first.
    expect(rules.outcome(tap(tapped, 0, state.drawAt + 100, state.drawAt + 900))).toEqual({ winner: 0 });
    // Its read never comes back in time: judged without it.
    expect(rules.outcome(tick(tapped, state.drawAt + 100 + READ_WAIT_MS))).toEqual({ winner: 1 });
    // It wasn't the seated player's chip.
    expect(rules.outcome(rules.step(tapped, { type: "release", seat: 0, now: state.drawAt + 900 }))).toEqual({ winner: 1 });
  });

  it("doesn't wait for a chip being read that touched later than the first tap", () => {
    const state = drawn(2);
    const first = tap(state, 1, state.drawAt + 150);
    const reading = rules.step(first, { type: "touch", seat: 0, at: state.drawAt + 400, now: state.drawAt + 405 });
    expect(rules.outcome(tick(reading, state.drawAt + 150 + SETTLE_MS))).toEqual({ winner: 1 });
  });

  it("a dead heat to the millisecond returns both stakes", () => {
    const state = drawn();
    const at = state.drawAt + 100;
    expect(rules.outcome(tap(tap(state, 0, at), 1, at))).toEqual({ winner: null });
  });

  it("a tap at the draw time counts even when no tick came first", () => {
    const start = rules.start(3, T0);
    const won = tick(tap(start, 0, start.drawAt + 5), start.drawAt + 5 + SETTLE_MS);
    expect(won.reason).toBe("first");
    expect(rules.outcome(won)).toEqual({ winner: 0 });
    expect(reactionMs(won, 0)).toBe(5);
  });

  it("ignores everything after the game is done, and a seat's second tap", () => {
    const state = drawn();
    const done = tick(tap(state, 0, state.drawAt + 100), state.drawAt + 100 + SETTLE_MS);
    expect(tap(done, 1, state.drawAt + 50, state.drawAt + 600)).toBe(done);
    expect(tick(done, state.drawAt + 5000)).toBe(done);
    const once = tap(state, 0, state.drawAt + 100);
    expect(tap(once, 0, state.drawAt + 120).taps).toEqual(once.taps);
    const early = tap(rules.start(2, T0), 0, T0 + 1);
    expect(tap(early, 1, early.drawAt + 10)).toBe(early);
    expect(reactionMs(early, 0)).toBeNull();
  });
});

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const start = Object.freeze(rules.start(4, T0));
    const frozen = { ...start, taps: Object.freeze([...start.taps]) as unknown as QuickDrawState["taps"] };
    const snapshot = structuredClone(frozen);
    tick(frozen, frozen.drawAt);
    tap(frozen, 0, frozen.drawAt - 1);
    tap(frozen, 1, frozen.drawAt + 1);
    rules.step(frozen, { type: "touch", seat: 0, at: frozen.drawAt + 1, now: frozen.drawAt + 2 });
    expect(frozen).toEqual(snapshot);
  });
});
