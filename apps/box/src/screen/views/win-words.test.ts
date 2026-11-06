import { describe, expect, it } from "vitest";
import type { Board, Settlement } from "../../core/types.ts";
import { winCards, type WinInput } from "./win-words.ts";

const NOW = 1_800_000_000_000;
const settlement: Settlement = {
  lines: [],
  names: ["nova.gamebox.eth", "kite.gamebox.eth"],
  paid: 40,
  title: { name: "champion.quickdraw.gamebox.eth", streak: 1 },
  cup: { name: "mumbai-cup.quickdraw.gamebox.eth", places: [{ rank: 1, points: 3 }, { rank: 0, points: 6 }] },
  stats: [null, { played: 5, wins: 4, losses: 1, draws: 0, streak: 3, best: 3 }],
};
const board: Board = {
  title: { name: "champion.quickdraw.gamebox.eth", holder: "kite.gamebox.eth", streak: 1, expires: NOW + 900_000 },
  cup: { name: "mumbai-cup.quickdraw.gamebox.eth", ends: NOW + 2_580_000, prize: 50, standings: [] },
  leaders: [],
  won: [],
};
const input = (over: Partial<WinInput> = {}): WinInput => ({
  match: { stake: 20, outcome: { winner: 1 } },
  settlement,
  game: "Quick Draw",
  board,
  fallback: ["PIXEL", "COMET"],
  now: NOW,
  ...over,
});

describe("what the result screen announces once the result is paid", () => {
  it("the pot, the title and the cup, in the order the transaction did them", () => {
    expect(winCards(input())).toEqual([
      {
        kind: "usdc",
        seat: 1,
        kicker: "PAID ON SEPOLIA",
        big: "+40 USDC",
        to: "→ kite.gamebox.eth",
        facts: ["THE WHOLE POT: 20 USDC FROM EACH PLAYER", "SENT STRAIGHT TO kite.gamebox.eth'S BADGE, IN ONE TRANSACTION", "STATS ON ENS NOW 4W 1L, STREAK 3"],
      },
      {
        kind: "title",
        seat: 1,
        kicker: "♛ TITLE TAKEN",
        big: "champion.quickdraw.gamebox.eth",
        to: "→ kite.gamebox.eth",
        facts: [
          "ON ENS THIS NAME NOW RESOLVES TO kite.gamebox.eth",
          "YOURS FOR 15M · EVERY WIN RESETS THE CLOCK",
          "THE NEXT QUICK DRAW WINNER TAKES IT · SOULBOUND, NEVER SOLD",
        ],
      },
      {
        kind: "cup",
        seat: 1,
        kicker: "★ +3 PTS IN MUMBAI-CUP",
        big: "mumbai-cup.quickdraw.gamebox.eth",
        to: "→ kite.gamebox.eth · LEADS WITH 6 PTS",
        facts: ["WHILE YOU LEAD, THIS NAME RESOLVES TO YOU", "AT THE CLOSE IN 43M THE LEADER WINS 50 USDC AND THIS NAME, FOREVER"],
      },
    ]);
  });

  it("a defended title says its streak; a place behind the leader says how far", () => {
    const [, title, cup] = winCards(
      input({
        settlement: { ...settlement, title: { name: "champion.quickdraw.gamebox.eth", streak: 3 }, cup: { name: "mumbai-cup.quickdraw.gamebox.eth", places: [null, { rank: 1, points: 3 }] } },
        board: { ...board, cup: { ...board.cup!, standings: [{ name: "orbit.gamebox.eth", points: 9, wins: 3, draws: 0, losses: 0 }] } },
      }),
    );
    expect(title?.kicker).toBe("♛ TITLE DEFENDED · 3 IN A ROW");
    expect(cup?.to).toBe("kite.gamebox.eth · 2ND WITH 3 PTS");
    expect(cup?.facts[0]).toBe("6 PTS BEHIND THE LEADER · A WIN IS 3, A DRAW 1");
  });

  it("only what happened: nothing for a draw, no pot, no title, no cup", () => {
    expect(winCards(input({ match: { stake: 20, outcome: { winner: null } } }))).toEqual([]);
    expect(winCards(input({ settlement: { ...settlement, paid: null, title: null, cup: null } }))).toEqual([]);
  });
});
