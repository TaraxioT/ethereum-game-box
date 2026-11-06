import { describe, expect, it } from "vitest";
import type { Board } from "../../core/types.ts";
import { onTheLine } from "./play-for.ts";

const NOW = 1_800_000_000_000;
const title = { name: "champion.stockduel.gamebox.eth", holder: "nova.gamebox.eth", streak: 2 };
const cup = { name: "cup-1921.stockduel.gamebox.eth", ends: NOW + 192_000, prize: 50, standings: [{ name: "orbit.gamebox.eth", points: 6, wins: 2, draws: 0, losses: 0 }] };
const board = (over: Partial<Board> = {}): Board => ({ title, cup, ...over });

describe("what Stake's plate says is on the line", () => {
  it("a USDC match: the pot, and the title and championship it also counts for", () => {
    expect(onTheLine({ stake: 10, playFor: "usdc", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "WINNER TAKES 20 USDC",
      detail: "10 USDC EACH · THE WIN ALSO TAKES THE TITLE AND SCORES CUP-1921",
    });
    expect(onTheLine({ stake: 5, playFor: "usdc", board: board({ cup: null }) }, "Stock Duel", NOW).detail).toBe("5 USDC EACH · THE WIN ALSO TAKES THE TITLE");
  });

  it("the title: who holds it, with no USDC", () => {
    expect(onTheLine({ stake: 10, playFor: "title", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "FOR THE STOCK DUEL TITLE",
      detail: "NOVA HOLDS THE TITLE ×2 · NO USDC STAKED",
    });
    expect(onTheLine({ stake: 10, playFor: "title", board: null }, "Stock Duel", NOW).detail).toBe("NOBODY HOLDS THE TITLE YET · NO USDC STAKED");
    const unnamed = board({ title: { ...title, holder: "0x24aF3b0c0e8D1D0a2bAc7b5d8f1e9a3c6d5e17D4", streak: 1 } });
    expect(onTheLine({ stake: 10, playFor: "title", board: unnamed }, "Stock Duel", NOW).detail).toBe("0x24aF…17D4 HOLDS THE TITLE · NO USDC STAKED");
  });

  it("the championship: its leader, prize and countdown, until it closes", () => {
    expect(onTheLine({ stake: 10, playFor: "cup", board: board() }, "Stock Duel", NOW)).toEqual({
      head: "FOR CUP-1921",
      detail: "WIN 3 · DRAW 1 · ORBIT LEADS · 6 PTS · 50 USDC PRIZE · 03:12 LEFT",
    });
    expect(onTheLine({ stake: 10, playFor: "cup", board: board() }, "Stock Duel", cup.ends).head).toBe("THE CHAMPIONSHIP HAS CLOSED");
  });
});
