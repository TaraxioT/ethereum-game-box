import { describe, expect, it } from "vitest";
import type { Seat } from "../seat.ts";
import { DECK, STATS } from "./deck.ts";
import {
  DEAL_MS,
  DIAL_MS,
  DWELL_MS,
  REVEAL_MS,
  dwellForRound,
  frontCard,
  frontIndex,
  frontRemainingMs,
  rules,
} from "./rules.ts";
import type { Stock, StockDuelState } from "./types.ts";

const T0 = 5_000_000;
const PICK_AT = T0 + DEAL_MS;

function stock(ticker: string, values: Partial<Stock> = {}): Stock {
  return { ticker, name: ticker, colour: "#ffffff", price: 1, avgPrice: 1, change24h: 0, liquidity: 1, ...values };
}

function picking(seed = 11): StockDuelState {
  return rules.step(rules.start(seed, T0), { type: "tick", now: PICK_AT });
}

/** A pick-phase state with hands we control. */
function picksWith(h0: readonly Stock[], h1: readonly Stock[]): StockDuelState {
  return { ...picking(), hands: [h0, h1] };
}

function tap(state: StockDuelState, seat: Seat, now: number, roll: number): StockDuelState {
  return rules.step(state, { type: "tap", seat, now, roll });
}

function tick(state: StockDuelState, now: number): StockDuelState {
  return rules.step(state, { type: "tick", now });
}

/** Both seats tap at the same time with the given rolls, and the dial, reveal and next pick follow on the clock. */
function playRound(state: StockDuelState, at: number, rolls: readonly [number, number]): StockDuelState {
  const dial = tap(tap(state, 0, at, rolls[0]), 1, at, rolls[1]);
  const reveal = tick(dial, at + DIAL_MS);
  return tick(reveal, at + DIAL_MS + REVEAL_MS);
}

describe("start", () => {
  it("deals four cards each, the same for a seed, with none shared", () => {
    const a = rules.start(99, T0);
    expect(a).toEqual(rules.start(99, T0));
    expect(a.phase).toBe("deal");
    expect(a.phaseAt).toBe(T0);
    expect(a.round).toBe(1);
    expect(a.score).toEqual([0, 0]);
    expect(a.hands[0]).toHaveLength(4);
    expect(a.hands[1]).toHaveLength(4);
    const tickers = [...a.hands[0], ...a.hands[1]].map((card) => card.ticker);
    expect(new Set(tickers).size).toBe(8);
    expect(tickers.every((t) => DECK.some((card) => card.ticker === t))).toBe(true);
    expect(rules.outcome(a)).toBeNull();
  });

  it("deals differently for different seeds and gives each seat its own roll", () => {
    const a = rules.start(1, T0);
    const b = rules.start(2, T0);
    expect(a.hands).not.toEqual(b.hands);
    expect(a.rolls[0]).not.toBe(a.rolls[1]);
    for (const roll of a.rolls) expect(Number.isInteger(roll) && roll >= 0 && roll <= 0xffffffff).toBe(true);
  });

  it("never shares a card between hands over many seeds", () => {
    for (let seed = 0; seed < 300; seed++) {
      const state = rules.start(seed, T0);
      const tickers = [...state.hands[0], ...state.hands[1]].map((card) => card.ticker);
      expect(new Set(tickers).size).toBe(8);
    }
  });
});

describe("the deal", () => {
  it("lasts DEAL_MS, then the pick begins with the drums set going", () => {
    const start = rules.start(5, T0);
    expect(tick(start, PICK_AT - 1)).toBe(start);
    const pick = tick(start, PICK_AT);
    expect(pick.phase).toBe("pick");
    expect(pick.phaseAt).toBe(PICK_AT);
    expect(pick.drumAt[0]).toBe(PICK_AT);
    expect(pick.drumAt[1]).toBe(PICK_AT - pick.dwellMs);
    expect(pick.dwellMs).toBe(DWELL_MS[0]);
  });

  it("ignores taps", () => {
    const start = rules.start(5, T0);
    expect(tap(start, 0, T0 + 100, 7)).toBe(start);
  });

  it("rests the drums where the pick starts, Player 2 one card ahead", () => {
    const start = rules.start(5, T0);
    expect(frontIndex(start, 0, T0 + 2500)).toBe(0);
    expect(frontIndex(start, 1, T0 + 2500)).toBe(1);
    expect(frontIndex(tick(start, PICK_AT), 1, PICK_AT)).toBe(1);
  });
});

describe("the front card", () => {
  it("follows the clock, one dwell per card, wrapping round the hand", () => {
    const pick = picking();
    const dwell = pick.dwellMs;
    const expected = (seat: Seat, steps: number) => (steps + (seat === 1 ? 1 : 0)) % 4;
    for (let steps = 0; steps < 9; steps++) {
      for (const seat of [0, 1] as const) {
        const now = PICK_AT + steps * dwell + dwell / 2;
        expect(frontIndex(pick, seat, now)).toBe(expected(seat, steps));
        expect(frontCard(pick, seat, now)).toBe(pick.hands[seat][expected(seat, steps)]);
      }
    }
  });

  it("turns at exact multiples of the dwell", () => {
    const pick = picking();
    expect(frontIndex(pick, 0, PICK_AT + pick.dwellMs - 1)).toBe(0);
    expect(frontIndex(pick, 0, PICK_AT + pick.dwellMs)).toBe(1);
  });

  it("reports the time left on the front card", () => {
    const pick = picking();
    expect(frontRemainingMs(pick, 0, PICK_AT)).toBe(pick.dwellMs);
    expect(frontRemainingMs(pick, 0, PICK_AT + 600)).toBe(pick.dwellMs - 600);
    expect(frontRemainingMs(pick, 1, PICK_AT + 600)).toBe(pick.dwellMs - 600);
    expect(frontRemainingMs(pick, 0, PICK_AT + pick.dwellMs)).toBe(pick.dwellMs);
  });

  it("stays on the played card once a seat has played, with no time left", () => {
    const pick = picking();
    const now = PICK_AT + pick.dwellMs * 2 + 100;
    const played = tap(pick, 0, now, 3);
    expect(frontIndex(played, 0, now + 5 * pick.dwellMs)).toBe(2);
    expect(frontRemainingMs(played, 0, now + 50)).toBe(0);
    expect(frontRemainingMs(played, 1, now + 50)).toBeGreaterThan(0);
  });
});

describe("tapping in the pick", () => {
  it("plays the front card as the drum shows it, with the badge's roll", () => {
    const pick = picking();
    const now = PICK_AT + pick.dwellMs * 3 + 40;
    const front = frontCard(pick, 0, now);
    const next = tap(pick, 0, now, 1234);
    expect(next.played[0]).toBe(front);
    expect(next.played[1]).toBeNull();
    expect(next.auto).toEqual([false, false]);
    expect(next.rolls[0]).toBe(1234);
    expect(next.rolls[1]).toBe(pick.rolls[1]);
    expect(next.phase).toBe("pick");
  });

  it("gives the other seat one full turn of its drum", () => {
    const pick = picking();
    const now = PICK_AT + 700;
    expect(tap(pick, 0, now, 1).deadline).toBe(now + pick.dwellMs * 4);
  });

  it("ignores a second tap from a seat that has played", () => {
    const pick = picking();
    const once = tap(pick, 1, PICK_AT + 100, 8);
    expect(tap(once, 1, PICK_AT + 900, 9)).toBe(once);
  });

  it("closes the pick when the second seat taps", () => {
    const pick = picking();
    const first = tap(pick, 0, PICK_AT + 100, 2);
    const both = tap(first, 1, PICK_AT + 1500, 6);
    expect(both.phase).toBe("dial");
    expect(both.phaseAt).toBe(PICK_AT + 1500);
    expect(both.played[0]).not.toBeNull();
    expect(both.played[1]).not.toBeNull();
    expect(both.auto).toEqual([false, false]);
    expect(both.stat).toBe(STATS[(2 + 6) % 4]);
  });
});

describe("running out of time", () => {
  it("plays the front card for the seat that waited a whole turn, keeping its roll", () => {
    const pick = picking();
    const at = PICK_AT + 900;
    const first = tap(pick, 0, at, 21);
    const deadline = first.deadline as number;
    const waiting = frontCard(pick, 1, at);
    expect(tick(first, deadline - 1)).toBe(first);
    const next = tick(first, deadline);
    expect(next.phase).toBe("dial");
    expect(next.auto).toEqual([false, true]);
    expect(next.played[1]).toBe(waiting);
    expect(next.rolls).toEqual([21, pick.rolls[1]]);
    expect(next.stat).toBe(STATS[((21 + pick.rolls[1]) >>> 0) % 4]);
  });

  it("judges a late tick at the deadline", () => {
    const first = tap(picking(), 1, PICK_AT + 300, 5);
    const late = tick(first, (first.deadline as number) + 1300);
    expect(late.played[0]).toBe(frontCard(first, 0, first.deadline as number));
    expect(late.auto).toEqual([true, false]);
  });

  it("plays for the waiting seat first when its tap arrives after the deadline", () => {
    const first = tap(picking(), 0, PICK_AT + 300, 5);
    const after = tap(first, 1, (first.deadline as number) + 50, 77);
    expect(after.auto).toEqual([false, true]);
    expect(after.rolls[1]).toBe(first.rolls[1]);
    expect(after.phase).toBe("dial");
  });

  it("waits forever while nobody has played", () => {
    const pick = picking();
    expect(tick(pick, PICK_AT + 600_000)).toBe(pick);
  });
});

describe("the stat", () => {
  it("is (roll1 + roll2) % 4 over the four stats", () => {
    for (const [r1, r2] of [
      [0, 0],
      [1, 0],
      [3, 3],
      [10, 5],
      [1000, 2001],
    ] as const) {
      const dial = tap(tap(picking(), 0, PICK_AT + 10, r1), 1, PICK_AT + 20, r2);
      expect(dial.stat).toBe(STATS[(r1 + r2) % 4]);
    }
  });

  it("adds as unsigned 32-bit numbers", () => {
    const dial = tap(tap(picking(), 0, PICK_AT + 10, 0xffffffff), 1, PICK_AT + 20, 2);
    expect(dial.stat).toBe(STATS[1]);
  });
});

describe("the flip", () => {
  const strong = stock("HI", { price: 300, avgPrice: 280, change24h: -1, liquidity: 9_000_000 });
  const weak = stock("LO", { price: 100, avgPrice: 120, change24h: -3, liquidity: 1_000_000 });

  it("waits out the dial, then the higher stat wins the round", () => {
    for (const [roll, stat] of [
      [0, "price"],
      [1, "avgPrice"],
      [2, "change24h"],
      [3, "liquidity"],
    ] as const) {
      const dial = tap(tap(picksWith([strong], [weak]), 0, PICK_AT + 5, roll), 1, PICK_AT + 6, 0);
      expect(dial.stat).toBe(stat);
      expect(tick(dial, PICK_AT + 6 + DIAL_MS - 1)).toBe(dial);
      const flipped = tick(dial, PICK_AT + 6 + DIAL_MS);
      expect(flipped.phase).toBe("reveal");
      expect(flipped.score).toEqual([1, 0]);
      expect(flipped.history).toEqual([{ cards: [strong, weak], stat, winner: 0 }]);
    }
  });

  it("gives the round to Player 2 when its card is higher", () => {
    const dial = tap(tap(picksWith([weak], [strong]), 0, PICK_AT + 5, 0), 1, PICK_AT + 6, 0);
    const flipped = tick(dial, PICK_AT + 6 + DIAL_MS);
    expect(flipped.score).toEqual([0, 1]);
    expect(flipped.history[0]?.winner).toBe(1);
  });

  it("leaves the cards in hand until the reveal is over", () => {
    const dial = tap(tap(picksWith([strong, weak], [weak, strong]), 0, PICK_AT + 5, 0), 1, PICK_AT + 6, 0);
    const flipped = tick(dial, PICK_AT + 6 + DIAL_MS);
    expect(flipped.hands[0]).toHaveLength(2);
    const reveal = flipped.phaseAt;
    expect(tick(flipped, reveal + REVEAL_MS - 1)).toBe(flipped);
    expect(tick(flipped, reveal + REVEAL_MS).hands[0]).toHaveLength(1);
  });
});

describe("rounds", () => {
  const cards0 = [stock("A0", { price: 50 }), stock("A1", { price: 60 }), stock("A2", { price: 70 }), stock("A3", { price: 80 })];
  const cards1 = [stock("B0", { price: 50 }), stock("B1", { price: 60 }), stock("B2", { price: 70 }), stock("B3", { price: 80 })];

  it("replays a tie with the next cards, using both up", () => {
    const level0 = [stock("A0", { price: 50 }), stock("A1", { price: 50 }), stock("A2", { price: 50 }), stock("A3", { price: 50 })];
    const level1 = [stock("B0", { price: 50 }), stock("B1", { price: 50 }), stock("B2", { price: 50 }), stock("B3", { price: 50 })];
    const dial = tap(tap(picksWith(level0, level1), 0, PICK_AT, 0), 1, PICK_AT, 0);
    expect(dial.stat).toBe("price");
    const flipped = tick(dial, PICK_AT + DIAL_MS);
    expect(flipped.score).toEqual([0, 0]);
    expect(flipped.history[0]?.winner).toBeNull();
    const next = tick(flipped, flipped.phaseAt + REVEAL_MS);
    expect(next.phase).toBe("pick");
    expect(next.round).toBe(2);
    expect(next.score).toEqual([0, 0]);
    expect(next.hands[0]).toHaveLength(3);
    expect(next.hands[1]).toHaveLength(3);
    const used = flipped.history[0]!.cards.map((card) => card.ticker);
    for (const hand of next.hands) for (const card of hand) expect(used).not.toContain(card.ticker);
  });

  it("removes the played cards and resets the round for the next pick", () => {
    const pick = picksWith(cards0, cards1);
    const afterRound = playRound(pick, PICK_AT, [0, 0]);
    expect(afterRound.phase).toBe("pick");
    expect(afterRound.round).toBe(2);
    expect(afterRound.hands[0]).toHaveLength(3);
    expect(afterRound.hands[1]).toHaveLength(3);
    expect(afterRound.played).toEqual([null, null]);
    expect(afterRound.auto).toEqual([false, false]);
    expect(afterRound.deadline).toBeNull();
    expect(afterRound.stat).toBeNull();
    expect(afterRound.dwellMs).toBe(DWELL_MS[1]);
    const nextAt = PICK_AT + DIAL_MS + REVEAL_MS;
    expect(afterRound.phaseAt).toBe(nextAt);
    expect(afterRound.drumAt).toEqual([nextAt, nextAt - DWELL_MS[1]!]);
    // The played cards are gone from both hands.
    const playedTickers = afterRound.history[0]!.cards.map((card) => card.ticker);
    for (const hand of afterRound.hands) for (const card of hand) expect(playedTickers).not.toContain(card.ticker);
  });

  it("keeps the last dwell for later rounds", () => {
    expect(dwellForRound(1)).toBe(2400);
    expect(dwellForRound(2)).toBe(2100);
    expect(dwellForRound(3)).toBe(1800);
    expect(dwellForRound(4)).toBe(1800);
    expect(dwellForRound(9)).toBe(1800);
  });

  it("ends the match when a seat wins two rounds", () => {
    // Seat 0 holds only stronger cards than seat 1, whatever the drums show.
    const hi = [stock("H0", { price: 90 }), stock("H1", { price: 91 }), stock("H2", { price: 92 }), stock("H3", { price: 93 })];
    const lo = [stock("L0", { price: 10 }), stock("L1", { price: 11 }), stock("L2", { price: 12 }), stock("L3", { price: 13 })];
    const first = playRound(picksWith(hi, lo), PICK_AT, [0, 0]);
    expect(first.phase).toBe("pick");
    expect(first.score).toEqual([1, 0]);
    expect(rules.outcome(first)).toBeNull();
    const at = first.phaseAt + 100;
    const over = playRound(first, at, [0, 0]);
    expect(over.phase).toBe("over");
    expect(over.score).toEqual([2, 0]);
    expect(over.winner).toBe(0);
    expect(rules.outcome(over)).toEqual({ winner: 0 });
    expect(over.hands[0]).toHaveLength(2);
  });

  it("goes to a third round when the rounds split", () => {
    const hi = [stock("H0", { price: 90 }), stock("H1", { price: 91 }), stock("H2", { price: 92 }), stock("H3", { price: 93 })];
    const lo = [stock("L0", { price: 10 }), stock("L1", { price: 11 }), stock("L2", { price: 12 }), stock("L3", { price: 13 })];
    const one = playRound(picksWith(hi, lo), PICK_AT, [0, 0]);
    // Swap which seat holds the strong cards for the second round.
    const two = playRound({ ...one, hands: [lo.slice(0, 3), hi.slice(0, 3)] }, one.phaseAt + 50, [0, 0]);
    expect(two.phase).toBe("pick");
    expect(two.round).toBe(3);
    expect(two.score).toEqual([1, 1]);
    expect(two.dwellMs).toBe(DWELL_MS[2]);
    expect(rules.outcome(two)).toBeNull();
  });
});

describe("hands running out", () => {
  const a = stock("A", { price: 10 });
  const b = stock("B", { price: 20 });

  function lastReveal(score: readonly [number, number]): StockDuelState {
    return {
      ...picking(),
      phase: "reveal",
      phaseAt: PICK_AT,
      round: 4,
      score,
      hands: [[a], [b]],
      played: [a, b],
      stat: "price",
    };
  }

  it("gives the match to the leader", () => {
    const one = tick(lastReveal([1, 0]), PICK_AT + REVEAL_MS);
    expect(one.phase).toBe("over");
    expect(one.winner).toBe(0);
    expect(one.hands).toEqual([[], []]);
    expect(rules.outcome(one)).toEqual({ winner: 0 });
    expect(rules.outcome(tick(lastReveal([0, 1]), PICK_AT + REVEAL_MS))).toEqual({ winner: 1 });
  });

  it("calls a level match a draw", () => {
    const over = tick(lastReveal([1, 1]), PICK_AT + REVEAL_MS);
    expect(over.phase).toBe("over");
    expect(over.winner).toBeNull();
    expect(rules.outcome(over)).toEqual({ winner: null });
    expect(rules.outcome(tick(lastReveal([0, 0]), PICK_AT + REVEAL_MS))).toEqual({ winner: null });
  });

  it("ends in a draw after four ties", () => {
    let state = picksWith(
      [stock("A0"), stock("A1"), stock("A2"), stock("A3")],
      [stock("B0"), stock("B1"), stock("B2"), stock("B3")],
    );
    let now = PICK_AT;
    for (let round = 1; round <= 4; round++) {
      expect(state.phase).toBe("pick");
      state = playRound(state, now, [0, 0]);
      now = state.phaseAt + 10;
    }
    expect(state.phase).toBe("over");
    expect(state.score).toEqual([0, 0]);
    expect(state.winner).toBeNull();
    expect(state.history).toHaveLength(4);
  });
});

describe("after the match", () => {
  it("ignores taps and ticks", () => {
    const hi = [stock("H0", { price: 90 }), stock("H1", { price: 91 }), stock("H2", { price: 92 })];
    const lo = [stock("L0", { price: 10 }), stock("L1", { price: 11 }), stock("L2", { price: 12 })];
    const first = playRound(picksWith(hi, lo), PICK_AT, [0, 0]);
    const over = playRound(first, first.phaseAt + 10, [0, 0]);
    expect(over.phase).toBe("over");
    expect(tap(over, 0, over.phaseAt + 5, 3)).toBe(over);
    expect(tick(over, over.phaseAt + 60_000)).toBe(over);
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const events = [
      (s: StockDuelState) => tick(s, T0 + DEAL_MS),
      (s: StockDuelState) => tap(s, 0, PICK_AT + 500, 5),
      (s: StockDuelState) => tap(s, 1, PICK_AT + 900, 6),
      (s: StockDuelState) => tick(s, PICK_AT + 900 + DIAL_MS),
      (s: StockDuelState) => tick(s, PICK_AT + 900 + DIAL_MS + REVEAL_MS),
    ];
    // Frozen states throw on any write, so a rule that mutated its input would fail here.
    let state = deepFreeze(rules.start(3, T0));
    for (const apply of events) state = deepFreeze(apply(state));
    expect(state.phase).toBe("pick");
    expect(state.round).toBe(2);
  });

  it("leaves the previous state equal to its copy", () => {
    const pick = picking();
    const copy = structuredClone(pick);
    tap(pick, 0, PICK_AT + 10, 1);
    tick(pick, PICK_AT + 1_000_000);
    expect(pick).toEqual(copy);
  });

  it("gives the same result for the same inputs", () => {
    const run = () => playRound(picking(21), PICK_AT + 450, [3, 8]);
    expect(run()).toEqual(run());
  });
});
