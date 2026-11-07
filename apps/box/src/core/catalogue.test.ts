import { describe, expect, it } from "vitest";
import { chainLabel, dealsLive, gameOfLabel, isStockDuel, isTeamGame, TEAM_GAMES } from "./catalogue.ts";

describe("the Stock Duel games", () => {
  it("ships Stock Duel Uniswap beside Stock Duel, playable, under its own label on chain", () => {
    const uniswap = TEAM_GAMES.find((g) => g.id === "stock-duel-uniswap");
    expect(uniswap).toMatchObject({ title: "Stock Duel Uniswap", kind: "team", ready: true });
    expect(chainLabel("stock-duel-uniswap")).toBe("stockduel-uniswap");
    expect(chainLabel("stock-duel")).toBe("stockduel");
    expect(gameOfLabel("stockduel-uniswap")?.id).toBe("stock-duel-uniswap");
    expect(gameOfLabel("stockduel")?.id).toBe("stock-duel");
  });

  it("plays both on Stock Duel's rules, and deals live numbers in Stock Duel Uniswap alone", () => {
    for (const id of ["stock-duel", "stock-duel-uniswap"]) {
      expect(isTeamGame(id)).toBe(true);
      expect(isStockDuel(id)).toBe(true);
    }
    expect(isStockDuel("quick-draw")).toBe(false);
    expect(dealsLive("stock-duel-uniswap")).toBe(true);
    expect(dealsLive("stock-duel")).toBe(false);
    expect(dealsLive("quick-draw")).toBe(false);
  });
});
