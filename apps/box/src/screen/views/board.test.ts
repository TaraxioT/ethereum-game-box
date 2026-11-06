import { describe, expect, it } from "vitest";
import type { AdminCup, AdminGame, Board } from "../../server/admin-wire.ts";
import { boardGames, playerWord } from "./board.ts";

const NOW = 1_800_000_000;
const NOVA = "0x84914AEf7D5Bd45a8ed6e47009828FaCf937C763";

const game = (label: string, holder: string | null, expiry: number, streak = 1): AdminGame => ({
  label,
  name: `${label}.gamebox.eth`,
  titleTerm: 900,
  title: { name: `champion.${label}.gamebox.eth`, holder, holderName: holder ? "nova.gamebox.eth" : null, streak, expiry, live: expiry > NOW },
  openCup: null,
});

const cup = (id: string, over: Partial<AdminCup>): AdminCup => ({
  id,
  game: "quickdraw",
  label: `cup-${id}`,
  name: `cup-${id}.quickdraw.gamebox.eth`,
  ends: NOW + 240,
  prize: "0",
  closed: false,
  winner: null,
  winnerName: null,
  leader: null,
  ...over,
});

const board = (games: AdminGame[], cups: AdminCup[]): Board => ({ block: "1", now: NOW, games, cups });

describe("the board", () => {
  it("names players by their label, or a short address", () => {
    expect(playerWord("nova.gamebox.eth", NOVA)).toBe("NOVA");
    expect(playerWord(null, NOVA)).toBe("0x8491…C763");
  });

  it("shows the games this Box plays, each with its title holder, streak and time left", () => {
    const rows = boardGames(board([game("quickdraw", NOVA, NOW + 250, 3), game("stockduel", NOVA, NOW - 5), game("tapwar", null, 0)], []), NOW);
    expect(rows.map((r) => [r.game, r.title.what, r.title.when])).toEqual([
      ["QUICK DRAW", "NOVA ×3", "4M 10S"],
      ["STOCK DUEL", "UP FOR GRABS", ""],
    ]);
  });

  it("puts each championship under its own game: open with its leader and prize, ended, or none", () => {
    const leader = { address: NOVA, name: "nova.gamebox.eth", points: 6 };
    const games = [game("quickdraw", null, 0), game("stockduel", null, 0)];
    const live = boardGames(board(games, [cup("4", { leader, prize: "25" })]), NOW);
    expect(live.map((r) => r.cup)).toEqual([
      { what: "CUP-4 · 25 USDC · NOVA 6 PTS", when: "4M", tone: "live" },
      { what: "NONE OPEN", when: "", tone: "none" },
    ]);
    const ended = boardGames(board(games, [cup("3", { ends: NOW - 1, leader })]), NOW);
    expect(ended[0]?.cup).toEqual({ what: "CUP-3 · NOVA WINS", when: "ENDED", tone: "done" });
  });

  it("shows a championship closed in the last hour with its winner, and drops an older one", () => {
    const games = [game("quickdraw", null, 0)];
    const won = cup("2", { closed: true, winner: NOVA, winnerName: "nova.gamebox.eth", ends: NOW - 60 });
    expect(boardGames(board(games, [won]), NOW)[0]?.cup).toEqual({ what: "CUP-2 · CLOSED", when: "WON BY NOVA", tone: "done" });
    expect(boardGames(board(games, [{ ...won, ends: NOW - 7_200 }]), NOW)[0]?.cup.what).toBe("NONE OPEN");
  });
});
