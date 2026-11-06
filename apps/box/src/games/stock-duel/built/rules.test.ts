// Stock Duel's built rules: the deal, the drums, a tap plays the card seen at the touch, the rolls choose the stat
// after both cards are down, the last turn, and the match's end.
import { describe, expect, it } from "vitest";
import type { BuiltEvent, DuelSeat } from "@egb/sdk";
import { STATS } from "./deck.ts";
import rules, { DEAL_MS, dwellForRound, frontIndex, HAND_SIZE, REVEAL_MS, SHOW_LAG_MS, type StockDuelState } from "./rules.ts";

const T0 = 1_000_000;
const tick = (now: number): BuiltEvent => ({ type: "tick", now });
const tap = (seat: DuelSeat, now: number, roll: number): BuiltEvent => ({ type: "tap", seat, now, roll });
const run = (state: StockDuelState, ...events: BuiltEvent[]) => events.reduce(rules.step, state);

/** The match after the deal, at the start of the pick. */
function picking(seed = 11): StockDuelState {
  return rules.step(rules.start(seed, T0), tick(T0 + DEAL_MS));
}

describe("Stock Duel's built rules", () => {
  it("deals four cards each from the seed, and holds the drums still during the deal", () => {
    const s = rules.start(11, T0);
    expect(s.hands.map((h) => h.length)).toEqual([HAND_SIZE, HAND_SIZE]);
    expect(new Set([...s.hands[0], ...s.hands[1]].map((c) => c.ticker)).size).toBe(HAND_SIZE * 2);
    expect(rules.start(11, T0)).toEqual(s);
    expect(frontIndex(s, 0, T0 + 2_000)).toBe(frontIndex(s, 0, T0));
    expect(rules.stations(s)[0]).toMatchObject({ big: "DEAL", small: "round 1  0 - 0" });
    expect(picking().phase).toBe("pick");
  });

  it("turns each drum a card per dwell, Player 2's a card ahead", () => {
    const s = picking();
    const at = s.phaseAt;
    const dwell = dwellForRound(1);
    expect(frontIndex(s, 0, at)).toBe(0);
    expect(frontIndex(s, 1, at)).toBe(1);
    expect(frontIndex(s, 0, at + dwell)).toBe(1);
    expect(frontIndex(s, 0, at + dwell * HAND_SIZE)).toBe(0);
  });

  it("plays the card in front SHOW_LAG_MS before the touch, and chooses the stat from both rolls once both are down", () => {
    const s = picking();
    const dwell = dwellForRound(1);
    // Touched just after the drum stepped: the screen still showed the card before.
    const one = rules.step(s, tap(0, s.phaseAt + dwell + SHOW_LAG_MS - 10, 5));
    expect(one.played[0]).toBe(s.hands[0][0]);
    expect(one.stat).toBeNull();
    expect(rules.stations(one)[0]).toMatchObject({ big: "PLAYED", small: s.hands[0][0]?.ticker });
    const both = rules.step(one, tap(1, s.phaseAt + 100, 2));
    expect(both.phase).toBe("reveal");
    expect(both.stat).toBe(STATS[(5 + 2) % STATS.length]);
    expect(both.history).toHaveLength(1);
    const [a, b] = [both.played[0], both.played[1]];
    const stat = both.stat ?? "price";
    const winner = a && b ? (a[stat] > b[stat] ? 0 : a[stat] < b[stat] ? 1 : null) : "?";
    expect(both.history[0]?.winner).toBe(winner);
    expect(both.score).toEqual(winner === null ? [0, 0] : winner === 0 ? [1, 0] : [0, 1]);
  });

  it("plays the front card for a seat whose last turn ran out, with its last roll", () => {
    const s = picking();
    const one = rules.step(s, tap(0, s.phaseAt + 100, 9));
    const deadline = one.deadline ?? 0;
    expect(deadline).toBe(s.phaseAt + 100 + dwellForRound(1) * HAND_SIZE);
    expect(rules.step(one, tick(deadline - 1)).phase).toBe("pick");
    const auto = rules.step(one, tick(deadline));
    expect(auto).toMatchObject({ phase: "reveal", auto: [false, true] });
    expect(auto.played[1]).toBe(one.hands[1][frontIndex(one, 1, deadline)]);
    // Its badge's roll after that is too late: the card was played for it.
    expect(rules.step(auto, tap(1, deadline + 50, 1)).played).toEqual(auto.played);
  });

  it("ends at two rounds, or when the hands run out with the leader winning", () => {
    let s = picking(3);
    for (let i = 0; i < HAND_SIZE * 2 && s.phase !== "over"; i++) {
      const at = s.phaseAt + 10;
      s = run(s, tap(0, at, i), tap(1, at + 5, i * 7), tick(at + 5 + REVEAL_MS));
    }
    expect(s.phase).toBe("over");
    const [one, two] = s.score;
    expect(s.winner).toBe(one > two ? 0 : two > one ? 1 : null);
    expect(Math.max(one, two) === 2 || s.hands.some((h) => h.length === 0)).toBe(true);
    expect(rules.outcome(s)).toEqual({ winner: s.winner });
    expect(rules.stations(s).map((v) => v.big)).toEqual(s.winner === null ? ["DRAW", "DRAW"] : s.winner === 0 ? ["WIN", "LOSE"] : ["LOSE", "WIN"]);
  });
});
