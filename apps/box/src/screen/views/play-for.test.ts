import { describe, expect, it } from "vitest";
import type { Board } from "../../core/types.ts";
import { judgedLine, onTheLine } from "./play-for.ts";

const NOW = 1_800_000_000_000;
const title = { name: "champion.stockduel.gamebox.eth", holder: "nova.gamebox.eth", streak: 2, expires: 1_800_000_600_000 };
const cup = { name: "cup-1921.stockduel.gamebox.eth", ends: NOW + 192_000, prize: 50, standings: [{ name: "orbit.gamebox.eth", points: 6, wins: 2, draws: 0, losses: 0 }] };
const board = (over: Partial<Board> = {}): Board => ({ title, cup, leaders: [], won: [], ...over });

describe("what Stake's plate says is on the line", () => {
  it("a store game: the pot the judge splits, and no title", () => {
    expect(judgedLine(10, 2)).toEqual({ head: "AN AI JUDGE SPLITS 20 USDC", plus: "", detail: "10 USDC EACH · STORE USDC · IF IT CAN'T JUDGE, EVERY STAKE GOES BACK" });
  });

  it("a USDC match: the pot, and the title and the cup it also counts for", () => {
    expect(onTheLine({ stake: 10, playFor: "usdc", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "WINNER TAKES 20 USDC",
      plus: "+ THE STOCK DUEL TITLE + 3 PTS IN CUP-1921",
      detail: "10 USDC EACH · EVERY WIN ON CHAIN TAKES THE TITLE",
    });
    expect(onTheLine({ stake: 5, playFor: "usdc", board: board({ cup: null }) }, "Stock Duel", NOW)).toMatchObject({ plus: "+ THE STOCK DUEL TITLE", detail: "5 USDC EACH · EVERY WIN ON CHAIN TAKES THE TITLE" });
  });

  it("the title: its own stake, and the title's ENS name resolving to its holder", () => {
    expect(onTheLine({ stake: 10, playFor: "title", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "WINNER TAKES 40 USDC",
      plus: "+ THE STOCK DUEL TITLE",
      detail: "20 USDC EACH · champion.stockduel.gamebox.eth → nova.gamebox.eth ×2",
    });
    expect(onTheLine({ stake: 10, playFor: "title", board: null }, "Stock Duel", NOW).detail).toBe("20 USDC EACH · NOBODY HOLDS THE TITLE YET");
  });

  it("the cup: its own stake and countdown, its ENS name resolving to the leader, and the prize, until it closes", () => {
    expect(onTheLine({ stake: 10, playFor: "cup", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "WINNER TAKES 30 USDC",
      plus: "+ 3 PTS IN CUP-1921 · 03:12 LEFT",
      detail: "15 USDC EACH · cup-1921.stockduel.gamebox.eth → orbit.gamebox.eth · 6 PTS · 50 USDC PRIZE",
    });
    expect(onTheLine({ stake: 10, playFor: "cup", board: board() }, "Stock Duel", cup.ends).head).toBe("THE CUP HAS CLOSED");
  });
});
