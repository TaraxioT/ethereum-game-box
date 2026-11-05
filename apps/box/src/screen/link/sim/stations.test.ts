import { describe, expect, it } from "vitest";
import type { Match, MatchPlay, Phase, SeatState, StationView } from "../types.ts";
import { rules as quickDraw } from "../../../games/quick-draw/rules.ts";
import { DEAL_MS, frontCard, rules as stockDuel } from "../../../games/stock-duel/rules.ts";
import { GAMES } from "./catalogue.ts";
import { DESK_BADGES } from "./badges.ts";
import { BIG_CHARS, LINE_CHARS, stationView, type StationInput } from "./stations.ts";

const NOW = 5_000_000;
const [NOVA, KITE] = DESK_BADGES as [(typeof DESK_BADGES)[0], (typeof DESK_BADGES)[0]];
const EMPTY: SeatState = { badge: null, balance: 0, signed: false };

function input(phase: Phase, seats: readonly [SeatState, SeatState] = [EMPTY, EMPTY], match: Match | null = null): StationInput {
  return {
    phase,
    games: GAMES,
    focus: "stock-duel",
    seats,
    chain: { block: 100, blockAt: NOW, blockMs: 12_000, gasGwei: 1 },
    stake: 10,
    match,
    txs: [],
  };
}

function seat(badge: typeof NOVA, signed = false, balance = 100): SeatState {
  return { badge, balance, signed };
}

function matchOf(play: MatchPlay, extra: Partial<Match> = {}): Match {
  return {
    id: 1,
    game: play.game,
    stake: 10,
    openedBlock: 98,
    refundBlock: 101,
    play,
    outcome: null,
    refunded: [false, false],
    ...extra,
  };
}

function fitsPanel(view: StationView): void {
  expect(view.top.length).toBeLessThanOrEqual(LINE_CHARS);
  expect(view.bottom.length).toBeLessThanOrEqual(LINE_CHARS);
  expect(view.big.length).toBeLessThanOrEqual(BIG_CHARS);
}

describe("station views", () => {
  const both = [seat(NOVA), seat(KITE)] as const;

  it("invites a tap on attract and on an empty seat", () => {
    expect(stationView(input("attract"), 0, NOW)).toEqual({ top: "GAME BOX", big: "TAP", bottom: "TO START" });
    expect(stationView(input("home"), 1, NOW)).toEqual({ top: "PLAYER 2", big: "TAP", bottom: "TO JOIN" });
  });

  it("shows the seated badge and its balance", () => {
    expect(stationView(input("join", both), 0, NOW)).toEqual({ top: "PLAYER 1", big: "NOVA", bottom: "100 EGB" });
  });

  it("asks for the signature, then waits for the other seat", () => {
    expect(stationView(input("stake", both), 0, NOW)).toEqual({ top: "NOVA", big: "SIGN", bottom: "10 EGB" });
    const one = [seat(NOVA, true), seat(KITE)] as const;
    expect(stationView(input("stake", one), 0, NOW)).toEqual({ top: "NOVA", big: "SIGNED", bottom: "WAITING" });
    const two = [seat(NOVA, true), seat(KITE, true)] as const;
    expect(stationView(input("stake", two), 1, NOW).bottom).toBe("OPENING");
  });

  it("runs Quick Draw: wait, the draw, then the outcome with the reaction time", () => {
    const wait = quickDraw.start(7, NOW);
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: wait })), 0, NOW).big).toBe("WAIT");
    const draw = quickDraw.step(wait, { type: "tick", now: wait.drawAt });
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: draw })), 1, NOW).big).toBe("TAP!");
    const done = quickDraw.step(draw, { type: "tap", seat: 1, now: wait.drawAt + 231 });
    const ended = input("result", both, matchOf({ game: "quick-draw", state: done }));
    expect(stationView(ended, 1, NOW)).toEqual({ top: "KITE", big: "WIN", bottom: "231 MS" });
    expect(stationView(ended, 0, NOW)).toEqual({ top: "NOVA", big: "LOSE", bottom: "NO TAP" });
    const early = quickDraw.step(wait, { type: "tap", seat: 0, now: NOW + 10 });
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: early })), 0, NOW).bottom).toBe("TOO EARLY");
  });

  it("shows each player their own Stock Duel front card, privately, then PLAYED", () => {
    const dealt = stockDuel.start(11, NOW);
    const at = NOW + DEAL_MS;
    const pick = stockDuel.step(dealt, { type: "tick", now: at });
    const state = input("playing", both, matchOf({ game: "stock-duel", state: pick }));
    for (const s of [0, 1] as const) {
      const view = stationView(state, s, at);
      expect(view.big).toBe(frontCard(pick, s, at)?.ticker);
      expect(view.bottom).toBe("TAP = PLAY");
      fitsPanel(view);
    }
    expect(stationView(state, 0, at).big).not.toBe(stationView(state, 1, at).big);
    const played = stockDuel.step(pick, { type: "tap", seat: 0, now: at, roll: 3 });
    const after = input("playing", both, matchOf({ game: "stock-duel", state: played }));
    expect(stationView(after, 0, at)).toMatchObject({ big: "PLAYED", bottom: frontCard(pick, 0, at)?.ticker });
  });

  it("counts the blocks to a refund, then offers it, then shows it paid", () => {
    const play: MatchPlay = { game: "quick-draw", state: quickDraw.start(1, NOW) };
    const waiting = input("refund", both, matchOf(play, { refundBlock: 103 }));
    expect(stationView(waiting, 0, NOW)).toEqual({ top: "NOVA", big: "OFFLINE", bottom: "WAIT 3 BLOCKS" });
    const one = input("refund", both, matchOf(play, { refundBlock: 101 }));
    expect(stationView(one, 0, NOW).bottom).toBe("WAIT 1 BLOCK");
    const open = input("refund", both, matchOf(play, { refundBlock: 100 }));
    expect(stationView(open, 0, NOW)).toEqual({ top: "NOVA", big: "TAP", bottom: "REFUND" });
    const paid = input("refund", both, matchOf(play, { refundBlock: 100, refunded: [true, false] }));
    expect(stationView(paid, 0, NOW)).toEqual({ top: "NOVA", big: "REFUNDED", bottom: "+10 EGB" });
  });

  it("keeps every line inside the panel through a whole Stock Duel", () => {
    let duel = stockDuel.start(99, NOW);
    for (let t = NOW; duel.phase !== "over" && t < NOW + 120_000; t += 100) {
      duel = stockDuel.step(duel, { type: "tick", now: t });
      if (duel.phase === "pick" && t % 700 === 0) duel = stockDuel.step(duel, { type: "tap", seat: 0, now: t, roll: t });
      const state = input("playing", [seat(NOVA), seat(KITE)], matchOf({ game: "stock-duel", state: duel }));
      fitsPanel(stationView(state, 0, t));
      fitsPanel(stationView(state, 1, t));
    }
    expect(duel.phase).toBe("over");
  });
});
