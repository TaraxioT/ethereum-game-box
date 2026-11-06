import { describe, expect, it } from "vitest";
import { BIG_CHARS, SMALL_CHARS, TAG_CHARS } from "@egb/sdk";
import type { Match, MatchPlay, Phase, SeatState, StationView } from "./types.ts";
import { rules as quickDraw } from "../games/quick-draw/rules.ts";
import { DEAL_MS, frontCard, rules as stockDuel } from "../games/stock-duel/rules.ts";
import { TEAM_GAMES } from "./catalogue.ts";
import { DEMO_BADGES } from "./badges.ts";
import { stationView, type StationInput } from "./stations.ts";

const NOW = 5_000_000;
const [NOVA, KITE] = DEMO_BADGES as [(typeof DEMO_BADGES)[0], (typeof DEMO_BADGES)[0]];
const EMPTY: SeatState = { badge: null, ens: null, balance: null, signed: false, pending: 0, record: null };

function input(phase: Phase, seats: readonly [SeatState, SeatState] = [EMPTY, EMPTY], match: Match | null = null): StationInput {
  return {
    phase,
    games: TEAM_GAMES,
    focus: "stock-duel",
    seats,
    chain: { block: 100, blockAt: NOW, blockMs: 12_000, gasGwei: 1 },
    stake: 10,
    playFor: "usdc",
    board: null,
    boards: {},
    taps: [null, null],
    match,
    txs: [],
    lobby: { badge: null, card: null, proposal: null, from: "home" },
  };
}

function seat(badge: typeof NOVA, signed = false, balance: number | null = 100): SeatState {
  return { badge, ens: null, balance, signed, pending: 0, record: null };
}

function matchOf(play: MatchPlay, extra: Partial<Match> = {}): Match {
  return {
    id: 1,
    game: play.game,
    playFor: "usdc",
    round: 1,
    stake: 10,
    openedBlock: 98,
    refundAt: NOW + 3_600_000,
    play,
    outcome: null,
    voided: false,
    endedAt: null,
    refunded: [false, false],
    lines: null,
    ...extra,
  };
}

/** The idle lines alone, as the station's own screen model holds them. */
function lines(view: StationView): { tag: string; big: string; small: string } {
  return { tag: view.tag, big: view.big, small: view.small };
}

function fitsStation(view: StationView): void {
  expect(view.tag.length).toBeLessThanOrEqual(TAG_CHARS);
  expect(view.big.length).toBeLessThanOrEqual(BIG_CHARS);
  expect(view.small.length).toBeLessThanOrEqual(SMALL_CHARS);
  expect(view.big).toBe(view.big.toUpperCase());
  for (const text of [view.tag, view.big, view.small]) expect(text).toMatch(/^[\x20-\x7e]*$/);
}

describe("station views", () => {
  const both = [seat(NOVA), seat(KITE)] as const;

  it("is blank while the Box boots", () => {
    expect(stationView(input("boot"), 0, NOW)).toEqual({ tag: "", big: "", small: "", mode: "shut" });
  });

  it("invites a tap on attract and on an empty seat", () => {
    expect(lines(stationView(input("attract"), 0, NOW))).toEqual({ tag: "P1", big: "TAP", small: "to start" });
    expect(lines(stationView(input("home"), 1, NOW))).toEqual({ tag: "P2", big: "TAP", small: "to join" });
  });

  it("shows the seated badge and its balance, and names it when a tap is done", () => {
    const view = stationView(input("join", both), 0, NOW);
    expect(view).toEqual({ tag: "P1", big: "NOVA", small: "100 USDC", done: "nova", mode: "open" });
    expect(stationView(input("home"), 0, NOW).done).toBeUndefined();
    // Before its balance is read from chain, and a fraction cut to whole USDC.
    expect(stationView(input("join", [seat(NOVA, false, null), EMPTY]), 0, NOW).small).toBe("... USDC");
    expect(stationView(input("join", [seat(NOVA, false, 12.5), EMPTY]), 0, NOW).small).toBe("12 USDC");
  });

  it("names a seated player by the whole ENS name, and says what a tap means now", () => {
    const named = { ...seat(NOVA, false, 20), ens: "nova.gamebox.eth" };
    const view = stationView(input("join", [named, EMPTY]), 0, NOW);
    expect(view).toMatchObject({ big: "NOVA.GAMEBOX.ETH", small: "20 USDC", done: "nova.gamebox.eth", mode: "open" });
    expect(stationView(input("build"), 0, NOW).mode).toBe("shut");
  });

  it("asks for a tap in the lobby at every station", () => {
    for (const s of [0, 1] as const) {
      const view = stationView(input("lobby", both), s, NOW);
      expect(lines(view)).toEqual({ tag: `P${s + 1}`, big: "LOBBY", small: "tap to see yours" });
      fitsStation(view);
    }
  });

  it("asks for the stake, then waits for the other seat", () => {
    expect(lines(stationView(input("stake", both), 0, NOW))).toEqual({ tag: "P1", big: "SIGN", small: "10 USDC" });
    const one = [seat(NOVA, true), seat(KITE)] as const;
    expect(lines(stationView(input("stake", one), 0, NOW))).toEqual({ tag: "P1", big: "SIGNED", small: "waiting" });
    const two = [seat(NOVA, true), seat(KITE, true)] as const;
    expect(stationView(input("stake", two), 1, NOW).small).toBe("opening");
  });

  it("runs Quick Draw: wait, the draw, then the outcome with the reaction time", () => {
    const wait = quickDraw.start(7, NOW);
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: wait })), 0, NOW).big).toBe("WAIT");
    const draw = quickDraw.step(wait, { type: "tick", now: wait.drawAt });
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: draw })), 1, NOW).big).toBe("DRAW!");
    const tapped = quickDraw.step(draw, { type: "tap", seat: 1, at: wait.drawAt + 231, now: wait.drawAt + 235 });
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: tapped })), 1, NOW)).toMatchObject({ big: "DRAW!", small: "231 ms" });
    const done = quickDraw.step(tapped, { type: "tick", now: wait.drawAt + 1000 });
    const ended = input("result", both, matchOf({ game: "quick-draw", state: done }));
    expect(lines(stationView(ended, 1, NOW))).toEqual({ tag: "P2", big: "WIN", small: "231 ms" });
    expect(lines(stationView(ended, 0, NOW))).toEqual({ tag: "P1", big: "LOSE", small: "no tap" });
    const early = quickDraw.step(wait, { type: "tap", seat: 0, at: NOW + 10, now: NOW + 12 });
    expect(stationView(input("playing", both, matchOf({ game: "quick-draw", state: early })), 0, NOW).small).toBe("too early");
  });

  it("shows each player their own Stock Duel front card, privately, rolls on the tap, then PLAYED", () => {
    const dealt = stockDuel.start(11, NOW);
    const at = NOW + DEAL_MS;
    const pick = stockDuel.step(dealt, { type: "tick", now: at });
    const state = input("playing", both, matchOf({ game: "stock-duel", state: pick }));
    for (const s of [0, 1] as const) {
      const view = stationView(state, s, at);
      expect(view.big).toBe(frontCard(pick, s, at)?.ticker);
      expect(view.small).toBe("tap to play");
      expect(view.sign).toBe("HOLD STILL|rolling");
      fitsStation(view);
    }
    expect(stationView(state, 0, at).big).not.toBe(stationView(state, 1, at).big);
    const played = stockDuel.step(pick, { type: "tap", seat: 0, now: at, roll: 3 });
    const after = input("playing", both, matchOf({ game: "stock-duel", state: played }));
    expect(stationView(after, 0, at)).toMatchObject({ big: "PLAYED", small: frontCard(pick, 0, at)?.ticker });
    expect(stationView(after, 0, at).sign).toBeUndefined();
  });

  it("counts the time to a refund, then offers it, then shows it paid", () => {
    const play: MatchPlay = { game: "quick-draw", state: quickDraw.start(1, NOW) };
    const waiting = input("refund", both, matchOf(play, { refundAt: NOW + 59 * 60_000 }));
    expect(lines(stationView(waiting, 0, NOW))).toEqual({ tag: "P1", big: "OFFLINE", small: "wait 59 min" });
    const last = input("refund", both, matchOf(play, { refundAt: NOW + 42_000 }));
    expect(stationView(last, 0, NOW).small).toBe("wait 42 s");
    const open = input("refund", both, matchOf(play, { refundAt: NOW }));
    expect(lines(stationView(open, 0, NOW))).toEqual({ tag: "P1", big: "TAP", small: "to refund" });
    const paid = input("refund", both, matchOf(play, { refundAt: NOW, refunded: [true, true] }));
    expect(lines(stationView(paid, 0, NOW))).toEqual({ tag: "P1", big: "REFUNDED", small: "+10 USDC" });
  });

  it("keeps every line inside the station, in printable ASCII, through a whole Stock Duel", () => {
    let duel = stockDuel.start(99, NOW);
    for (let t = NOW; duel.phase !== "over" && t < NOW + 120_000; t += 100) {
      duel = stockDuel.step(duel, { type: "tick", now: t });
      if (duel.phase === "pick" && t % 700 === 0) duel = stockDuel.step(duel, { type: "tap", seat: 0, now: t, roll: t });
      const state = input("playing", [seat(NOVA), seat(KITE)], matchOf({ game: "stock-duel", state: duel }));
      fitsStation(stationView(state, 0, t));
      fitsStation(stationView(state, 1, t));
    }
    expect(duel.phase).toBe("over");
  });
});
