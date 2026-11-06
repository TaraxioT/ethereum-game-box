import { describe, expect, it } from "vitest";
import type { AdminCup, AdminGame, Board } from "../../server/admin-wire.ts";
import { boardRows, playerWord } from "./board.ts";

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

  it("lists only titles still held, with streak and time left", () => {
    const rows = boardRows(board([game("quickdraw", NOVA, NOW + 250, 3), game("stockduel", NOVA, NOW - 5), game("tapwar", null, 0)], []), NOW);
    expect(rows.champions).toEqual([["QUICKDRAW", "NOVA ×3", "4M 10S"]]);
  });

  it("lists open championships with their leader and prize, and an ended one as won", () => {
    const leader = { address: NOVA, name: "nova.gamebox.eth", points: 6 };
    const rows = boardRows(board([], [cup("4", { leader, prize: "25" }), cup("3", { ends: NOW - 1, leader }), cup("2", { closed: true, winner: NOVA })]), NOW);
    expect(rows.cups).toEqual([
      ["CUP-4", "NOVA 6 PTS", "25 USDC · 4M"],
      ["CUP-3", "NOVA WINS", "ENDED"],
    ]);
  });

  it("shows the last closed championship when none is open", () => {
    const rows = boardRows(board([], [cup("2", { closed: true, winner: NOVA, winnerName: "nova.gamebox.eth" }), cup("1", { closed: true })]), NOW);
    expect(rows.cups).toEqual([["CUP-2", "WON BY NOVA", "CLOSED"]]);
  });
});
