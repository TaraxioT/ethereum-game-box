import { describe, expect, it } from "vitest";
import type { DuelSeat } from "@egb/sdk";
import {
  COUNT_MS, DECOY_MS, decoyAt, fouler, MAX_STANDOFFS, MAX_WAIT_MS, MIN_WAIT_MS, READ_WAIT_MS, reactionMs, ROUND_MS, rules, SETTLE_MS, TOO_SLOW_MS,
} from "./rules.ts";
import type { QuickDrawState } from "./types.ts";

const T0 = 1_000_000;

/** The seated player's chip touched at `at`; the Box hears of it at `now` (just after, by default). */
const tap = (state: QuickDrawState, seat: DuelSeat, at: number, now = at + 5) => rules.step(state, { type: "tap", seat, at, now });
const tick = (state: QuickDrawState, now: number) => rules.step(state, { type: "tick", now });

/** The first standoff, counted in: the sign reads WAIT…. */
function waiting(seed = 1): QuickDrawState {
  const start = rules.start(seed, T0);
  return tick(start, start.startedAt);
}

/** The first standoff, at its draw. */
function drawn(seed = 1): QuickDrawState {
  const start = rules.start(seed, T0);
  return tick(start, start.drawAt);
}

/** The standoff is won by `seat`, 200 ms after the draw, and the next one counted in. */
function takeRound(state: QuickDrawState, seat: DuelSeat): QuickDrawState {
  const won = tick(tap(tick(state, state.drawAt), seat, state.drawAt + 200), state.drawAt + 200 + SETTLE_MS);
  return won.phase === "round" ? tick(won, (won.decidedAt ?? 0) + ROUND_MS) : won;
}

describe("start", () => {
  it("counts in for COUNT_MS, then waits, with the draw 2 to 6 seconds after the count for every seed", () => {
    for (let seed = 0; seed < 5000; seed++) {
      const state = rules.start(seed, T0);
      expect(state).toMatchObject({ phase: "count", round: 1, score: [0, 0], countAt: T0, startedAt: T0 + COUNT_MS });
      expect(state.drawAt - state.startedAt).toBeGreaterThanOrEqual(MIN_WAIT_MS);
      expect(state.drawAt - state.startedAt).toBeLessThanOrEqual(MAX_WAIT_MS);
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

describe("decoys", () => {
  it("come in some standoffs and not others, inside the wait and well clear of the draw, never overlapping", () => {
    let some = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const state = rules.start(seed, T0);
      if (state.decoys.length > 0) some++;
      let last = -Infinity;
      for (const decoy of state.decoys) {
        expect(decoy.at).toBeGreaterThan(state.startedAt);
        expect(decoy.at + DECOY_MS).toBeLessThan(state.drawAt);
        expect(decoy.at).toBeGreaterThan(last);
        expect(decoy.word).not.toBe("DRAW");
        last = decoy.at + DECOY_MS;
      }
    }
    expect(some).toBeGreaterThan(400);
    expect(some).toBeLessThan(1600);
  });

  it("show only while the sign reads WAIT…, and a tap on one is a foul", () => {
    const seed = Array.from({ length: 200 }, (_, i) => i).find((i) => rules.start(i, T0).decoys.length > 0) ?? 0;
    const state = waiting(seed);
    const decoy = state.decoys[0];
    if (!decoy) throw new Error("no decoy");
    expect(decoyAt(state, decoy.at)).toEqual(decoy);
    expect(decoyAt(state, decoy.at + DECOY_MS)).toBeNull();
    expect(decoyAt(rules.start(seed, T0), decoy.at)).toBeNull();
    const foul = tap(state, 0, decoy.at + 100);
    expect(foul).toMatchObject({ phase: "round", reason: "early", took: 1, score: [0, 1] });
    expect(fouler(foul)).toBe(0);
  });
});

describe("the countdown", () => {
  it("ignores taps until it ends, then the sign reads WAIT… and flips at the draw", () => {
    const start = rules.start(3, T0);
    expect(tap(start, 0, T0 + 500)).toEqual(start);
    expect(tick(start, start.startedAt - 1).phase).toBe("count");
    expect(tick(start, start.startedAt).phase).toBe("wait");
    expect(tick(start, start.drawAt - 1).phase).toBe("wait");
    expect(tick(start, start.drawAt).phase).toBe("draw");
  });
});

describe("judging by touch time", () => {
  it("a touch before the draw is a foul: the round goes to the other seat", () => {
    const state = waiting(3);
    const early = tap(state, 0, state.drawAt - 10);
    expect(early).toMatchObject({ phase: "round", reason: "early", took: 1, winner: 1, score: [0, 1] });
    expect(fouler(early)).toBe(0);
    expect(rules.outcome(early)).toBeNull();
    expect(tap(state, 1, state.startedAt + 1)).toMatchObject({ took: 0, score: [1, 0] });
  });

  it("judges an early touch by its time, even when the Box hears of it after the flip", () => {
    const state = drawn(4);
    const early = tap(state, 1, state.drawAt - 3, state.drawAt + 20);
    expect(early).toMatchObject({ reason: "early", took: 0 });
  });

  it("a good tap waits SETTLE_MS from its touch for the other station, then takes the round", () => {
    const state = drawn();
    const one = tap(state, 1, state.drawAt + 240);
    expect(one.phase).toBe("draw");
    expect(tick(one, state.drawAt + 240 + SETTLE_MS - 1).phase).toBe("draw");
    const won = tick(one, state.drawAt + 240 + SETTLE_MS);
    expect(won).toMatchObject({ phase: "round", reason: "first", took: 1, score: [0, 1], decidedAt: state.drawAt + 240 + SETTLE_MS });
    expect(reactionMs(won, 1)).toBe(240);
    expect(reactionMs(won, 0)).toBeNull();
    expect(fouler(won)).toBeNull();
  });

  it("the earlier touch wins, whichever the Box heard first", () => {
    const state = drawn();
    const later = tap(state, 0, state.drawAt + 300, state.drawAt + 305);
    const both = tap(later, 1, state.drawAt + 280, state.drawAt + 330);
    expect(both.took).toBe(1);
    expect([reactionMs(both, 0), reactionMs(both, 1)]).toEqual([300, 280]);
  });

  it("waits for a chip still being read that touched earlier, at most READ_WAIT_MS", () => {
    const state = drawn(2);
    const reading = rules.step(state, { type: "touch", seat: 0, at: state.drawAt + 100, now: state.drawAt + 105 });
    const tapped = tap(reading, 1, state.drawAt + 200);
    expect(tick(tapped, state.drawAt + 1000).phase).toBe("draw");
    // Its read comes back: it was the seated player's chip, and it was first.
    expect(tap(tapped, 0, state.drawAt + 100, state.drawAt + 900).took).toBe(0);
    // Its read never comes back in time: judged without it.
    expect(tick(tapped, state.drawAt + 100 + READ_WAIT_MS).took).toBe(1);
    // It wasn't the seated player's chip.
    expect(rules.step(tapped, { type: "release", seat: 0, now: state.drawAt + 900 }).took).toBe(1);
  });

  it("doesn't wait for a chip being read that touched later than the first tap", () => {
    const state = drawn(2);
    const first = tap(state, 1, state.drawAt + 150);
    const reading = rules.step(first, { type: "touch", seat: 0, at: state.drawAt + 400, now: state.drawAt + 405 });
    expect(tick(reading, state.drawAt + 150 + SETTLE_MS).took).toBe(1);
  });

  it("a tap at the draw time counts even when no tick came first", () => {
    const state = waiting(3);
    const won = tick(tap(state, 0, state.drawAt + 5), state.drawAt + 5 + SETTLE_MS);
    expect(won).toMatchObject({ reason: "first", took: 0 });
    expect(reactionMs(won, 0)).toBe(5);
  });

  it("ignores a seat's second tap, and every tap between rounds", () => {
    const state = drawn();
    const once = tap(state, 0, state.drawAt + 100);
    expect(tap(once, 0, state.drawAt + 120).taps).toEqual(once.taps);
    const decided = tick(once, state.drawAt + 100 + SETTLE_MS);
    expect(decided.phase).toBe("round");
    expect(tap(decided, 1, state.drawAt + 50, state.drawAt + 600)).toEqual(decided);
  });
});

describe("rounds nobody takes", () => {
  it("a dead heat to the millisecond gives nobody the round, and it is played again", () => {
    const state = drawn();
    const at = state.drawAt + 100;
    const heat = tap(tap(state, 0, at), 1, at);
    expect(heat).toMatchObject({ phase: "round", reason: "heat", took: null, score: [0, 0] });
    const again = tick(heat, (heat.decidedAt ?? 0) + ROUND_MS);
    expect(again).toMatchObject({ phase: "count", round: 1, standoff: 2 });
  });

  it("nobody touching within TOO_SLOW_MS of the draw gives nobody the round", () => {
    const state = drawn(5);
    expect(tick(state, state.drawAt + TOO_SLOW_MS - 1).phase).toBe("draw");
    const slow = tick(state, state.drawAt + TOO_SLOW_MS);
    expect(slow).toMatchObject({ phase: "round", reason: "slow", took: null, score: [0, 0] });
    const again = tick(slow, slow.drawAt + TOO_SLOW_MS + ROUND_MS);
    expect(again).toMatchObject({ phase: "count", standoff: 2, round: 1, taps: [null, null] });
    expect(again.drawAt - again.startedAt).toBeGreaterThanOrEqual(MIN_WAIT_MS);
    // A touch from the last standoff doesn't count in this one.
    expect(tap(again, 0, state.drawAt + 100, again.countAt + 10)).toEqual(again);
  });
});

describe("best of three", () => {
  it("holds a decided round for ROUND_MS, then counts in the next with a new draw time", () => {
    const won = tick(tap(drawn(), 0, drawn().drawAt + 200), drawn().drawAt + 200 + SETTLE_MS);
    const at = won.decidedAt ?? 0;
    expect(tick(won, at + ROUND_MS - 1)).toBe(won);
    const next = tick(won, at + ROUND_MS);
    expect(next).toMatchObject({ phase: "count", round: 2, standoff: 2, score: [1, 0], taps: [null, null], reason: null, took: null });
    expect(next.drawAt).not.toBe(won.drawAt);
  });

  it("the first to take two rounds takes the match, 2-0 or 2-1", () => {
    const twoNil = takeRound(takeRound(rules.start(1, T0), 1), 1);
    expect(twoNil).toMatchObject({ phase: "done", winner: 1, score: [0, 2] });
    expect(rules.outcome(twoNil)).toEqual({ winner: 1 });

    const one = takeRound(rules.start(2, T0), 0);
    expect(one).toMatchObject({ phase: "count", round: 2, score: [1, 0] });
    const two = takeRound(one, 1);
    expect(two).toMatchObject({ phase: "count", round: 3, score: [1, 1] });
    const three = takeRound(two, 0);
    expect(three).toMatchObject({ phase: "done", winner: 0, score: [2, 1], took: 0, reason: "first" });
    expect(rules.outcome(three)).toEqual({ winner: 0 });
  });

  it("a foul in the deciding round ends the match for the other seat", () => {
    const tied = takeRound(takeRound(rules.start(3, T0), 0), 1);
    const waitingNow = tick(tied, tied.startedAt);
    const foul = tap(waitingNow, 1, waitingNow.startedAt + 50);
    expect(foul).toMatchObject({ phase: "done", winner: 0, score: [2, 1], reason: "early" });
    expect(fouler(foul)).toBe(1);
  });

  it("ends after MAX_STANDOFFS whatever happens: the one ahead wins, level is a draw", () => {
    let state = rules.start(9, T0);
    for (let i = 0; i < MAX_STANDOFFS; i++) {
      const slow = tick(tick(state, state.drawAt), state.drawAt + TOO_SLOW_MS);
      state = slow.phase === "round" ? tick(slow, (slow.decidedAt ?? 0) + ROUND_MS) : slow;
    }
    expect(state).toMatchObject({ phase: "done", winner: null, standoff: MAX_STANDOFFS });
    expect(rules.outcome(state)).toEqual({ winner: null });

    let ahead = takeRound(rules.start(9, T0), 1);
    for (let i = 1; i < MAX_STANDOFFS; i++) {
      const slow = tick(tick(ahead, ahead.drawAt), ahead.drawAt + TOO_SLOW_MS);
      ahead = slow.phase === "round" ? tick(slow, (slow.decidedAt ?? 0) + ROUND_MS) : slow;
    }
    expect(ahead).toMatchObject({ phase: "done", winner: 1, score: [0, 1] });
  });

  it("ignores everything once the match is done", () => {
    const done = takeRound(takeRound(rules.start(1, T0), 0), 0);
    expect(done.phase).toBe("done");
    expect(tap(done, 1, done.drawAt + 50, done.drawAt + 600)).toBe(done);
    expect(tick(done, done.drawAt + 50_000)).toBe(done);
  });
});

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const start = Object.freeze(waiting(4));
    const frozen = { ...start, taps: Object.freeze([...start.taps]) as unknown as QuickDrawState["taps"] };
    const snapshot = structuredClone(frozen);
    tick(frozen, frozen.drawAt);
    tap(frozen, 0, frozen.drawAt - 1);
    tap(frozen, 1, frozen.drawAt + 1);
    rules.step(frozen, { type: "touch", seat: 0, at: frozen.drawAt + 1, now: frozen.drawAt + 2 });
    expect(frozen).toEqual(snapshot);
  });
});
