import { describe, expect, it, vi } from "vitest";
import type { BoxState, SeatState } from "./types.ts";
import { mulberry32, stationView } from "@egb/sdk";
import { rules as quickDraw } from "../games/quick-draw/rules.ts";
import { DEAL_MS, rules as stockDuel } from "../games/stock-duel/rules.ts";
import { TEAM_GAMES } from "./catalogue.ts";
import { createFakeClock } from "./fake-clock.ts";
import { BOT_BADGE, DEMO_BADGES } from "./badges.ts";
import {
  botDelay,
  botIntent,
  createBot,
  EARLY_CHANCE,
  JOIN_MS,
  PLAY_CHANCE,
  REACT_MS,
  REFUND_MS,
  SIGN_MS,
  THINK_MS,
  type BotIntent,
} from "./bot.ts";

const NOW = 9_000_000;
const NOVA = DEMO_BADGES[0] ?? BOT_BADGE;
const EMPTY: SeatState = { badge: null, ens: null, balance: null, signed: false, pending: 0, record: null };

function box(patch: Partial<BoxState>): BoxState {
  return {
    phase: "home",
    games: TEAM_GAMES,
    focus: "quick-draw",
    seats: [EMPTY, EMPTY],
    chain: { block: 50, blockAt: NOW, blockMs: 12_000, gasGwei: 1 },
    stake: 10,
    playFor: "usdc",
    board: null,
    boards: {},
    taps: [null, null],
    match: null,
    txs: [],
    lobby: { badge: null, card: null, proposal: null, from: "home" },
    stations: [stationView("", "", ""), stationView("", "", "")],
    ...patch,
  };
}

const human = (signed = false): SeatState => ({ badge: NOVA, ens: null, balance: 100, signed, pending: 0, record: null });
const bot = (signed = false): SeatState => ({ badge: BOT_BADGE, ens: null, balance: 100, signed, pending: 0, record: null });

function delays(intent: BotIntent, runs = 4_000): (number | null)[] {
  const out: (number | null)[] = [];
  for (let seed = 1; seed <= runs; seed++) out.push(botDelay(intent, mulberry32(seed)));
  return out;
}

function within(values: (number | null)[], [low, high]: readonly [number, number]): void {
  for (const value of values) {
    expect(value).not.toBeNull();
    expect(value).toBeGreaterThanOrEqual(low);
    expect(value).toBeLessThanOrEqual(high);
  }
}

describe("bot intents", () => {
  it("joins once Player 1 sits on Home, or on Join", () => {
    expect(botIntent(box({}), NOW, BOT_BADGE)).toBeNull();
    expect(botIntent(box({ seats: [human(), EMPTY] }), NOW, BOT_BADGE)?.kind).toBe("join");
    expect(botIntent(box({ phase: "join" }), NOW, BOT_BADGE)?.kind).toBe("join");
  });

  it("signs only after Player 1 has signed", () => {
    expect(botIntent(box({ phase: "stake", seats: [human(), bot()] }), NOW, BOT_BADGE)).toBeNull();
    expect(botIntent(box({ phase: "stake", seats: [human(true), bot()] }), NOW, BOT_BADGE)?.kind).toBe("sign");
    expect(botIntent(box({ phase: "stake", seats: [human(true), bot(true)] }), NOW, BOT_BADGE)).toBeNull();
  });

  it("sits out while somebody else holds Player 2's seat", () => {
    const kite: SeatState = { badge: DEMO_BADGES[1] ?? NOVA, ens: null, balance: 100, signed: false, pending: 0, record: null };
    expect(botIntent(box({ phase: "stake", seats: [human(true), kite] }), NOW, BOT_BADGE)).toBeNull();
  });

  it("waits for the draw in Quick Draw, and for its refund to open", () => {
    const state = quickDraw.start(3, NOW);
    const match = {
      id: 4,
      game: "quick-draw" as const,
      playFor: "usdc" as const,
      round: 4,
      stake: 10,
      openedBlock: 48,
      refundAt: NOW + 60_000,
      play: { game: "quick-draw" as const, state },
      outcome: null,
      voided: false,
      endedAt: null,
      refunded: [false, false] as const,
      lines: null,
    };
    const playing = botIntent(box({ phase: "playing", seats: [human(true), bot(true)], match }), NOW, BOT_BADGE);
    expect(playing).toEqual({ kind: "draw", key: "draw:4", untilDraw: state.drawAt - NOW });
    expect(botIntent(box({ phase: "refund", seats: [human(), bot()], match }), NOW, BOT_BADGE)).toBeNull();
    const open = box({ phase: "refund", seats: [human(), bot()], match });
    expect(botIntent(open, NOW + 60_000, BOT_BADGE)?.kind).toBe("refund");
  });
});

describe("bot timing", () => {
  it("joins in 0.8–1.6 s, signs in 0.7–1.5 s and refunds in 1–2 s", () => {
    within(delays({ kind: "join", key: "join" }), JOIN_MS);
    within(delays({ kind: "sign", key: "sign" }), SIGN_MS);
    within(delays({ kind: "refund", key: "refund:1" }), REFUND_MS);
  });

  it("reacts 220–420 ms after the draw, and now and then taps early", () => {
    const untilDraw = 3_000;
    const values = delays({ kind: "draw", key: "draw:1", untilDraw }, 10_000);
    const early = values.filter((value) => value !== null && value < untilDraw);
    for (const value of values) {
      if (value !== null && value < untilDraw) expect(value).toBeGreaterThan(0);
      else within([value], [untilDraw + REACT_MS[0], untilDraw + REACT_MS[1]]);
    }
    expect(early.length / values.length).toBeGreaterThan(EARLY_CHANCE / 2);
    expect(early.length / values.length).toBeLessThan(EARLY_CHANCE * 2);
  });

  it("plays some Stock Duel cards, after a 0.6–2.2 s think that ends while the card is in front", () => {
    for (const remainingMs of [2_400, 1_500, 700]) {
      const values = delays({ kind: "card", key: "card:1:1:0", remainingMs });
      const played = values.filter((value): value is number => value !== null);
      for (const value of played) {
        expect(value).toBeGreaterThanOrEqual(THINK_MS[0]);
        expect(value).toBeLessThanOrEqual(Math.min(THINK_MS[1], remainingMs));
      }
      expect(played.length / values.length).toBeGreaterThan(PLAY_CHANCE - 0.05);
      expect(played.length / values.length).toBeLessThan(PLAY_CHANCE + 0.05);
    }
    expect(delays({ kind: "card", key: "card:1:1:0", remainingMs: 500 }).every((value) => value === null)).toBe(true);
  });
});

describe("bot scheduler", () => {
  it("taps once per moment, and not at all once the moment has passed", () => {
    const clock = createFakeClock(NOW);
    let state = box({ seats: [human(), EMPTY] });
    const tap = vi.fn();
    const driver = createBot({ badge: BOT_BADGE, clock, state: () => state, active: () => true, tap, rnd: mulberry32(5) });
    driver.update();
    driver.update();
    clock.advance(JOIN_MS[0] - 1);
    expect(tap).not.toHaveBeenCalled();
    clock.advance(JOIN_MS[1] - JOIN_MS[0] + 1);
    expect(tap).toHaveBeenCalledTimes(1);

    state = box({ phase: "stake", seats: [human(true), bot()] });
    driver.update();
    state = box({ phase: "home", seats: [EMPTY, bot()] });
    driver.update();
    clock.advance(SIGN_MS[1]);
    expect(tap).toHaveBeenCalledTimes(1);
    driver.stop();
  });

  it("plays a Stock Duel card before it leaves the front", () => {
    const dealt = stockDuel.start(21, NOW);
    let duel = stockDuel.step(dealt, { type: "tick", now: NOW + DEAL_MS });
    const clock = createFakeClock(NOW + DEAL_MS);
    const matchOf = () => ({
      id: 2,
      game: "stock-duel" as const,
      playFor: "usdc" as const,
      round: 4,
      stake: 10,
      openedBlock: 48,
      refundAt: NOW + 60_000,
      play: { game: "stock-duel" as const, state: duel },
      outcome: null,
      voided: false,
      endedAt: null,
      refunded: [false, false] as const,
      lines: null,
    });
    const tap = vi.fn(() => {
      duel = stockDuel.step(duel, { type: "tap", seat: 1, now: clock.now(), roll: 1 });
    });
    const driver = createBot({
      badge: BOT_BADGE,
      clock,
      state: () => box({ phase: "playing", seats: [human(true), bot(true)], match: matchOf() }),
      active: () => true,
      tap,
      rnd: mulberry32(8),
    });
    for (let i = 0; i < 1_000 && duel.played[1] === null; i++) {
      driver.update();
      clock.advance(50);
    }
    expect(tap).toHaveBeenCalledTimes(1);
    expect(duel.played[1]).not.toBeNull();
    expect(duel.auto[1]).toBe(false);
    driver.stop();
  });
});
