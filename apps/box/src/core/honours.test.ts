import { describe, expect, it } from "vitest";
import { honoursOf } from "./honours.ts";
import type { Board } from "./types.ts";

const NOW = 1_800_000_000_000;
const standings = (name: string) => [{ name, points: 6, wins: 2, draws: 0, losses: 0 }];
const boards: Record<string, Board> = {
  "stock-duel": { title: { name: "champion.stockduel.gamebox.eth", holder: "nova.gamebox.eth", streak: 2 }, cup: { name: "cup-1.stockduel.gamebox.eth", ends: NOW + 60_000, prize: 0, standings: standings("orbit.gamebox.eth") } },
  "quick-draw": { title: null, cup: { name: "cup-2.quickdraw.gamebox.eth", ends: NOW + 60_000, prize: 50, standings: standings("nova.gamebox.eth") } },
};

describe("what a player holds", () => {
  it("lists the titles their ENS name holds, then the open championships it leads", () => {
    expect(honoursOf("nova.gamebox.eth", boards, NOW)).toEqual([
      { kind: "title", game: "stock-duel", name: "champion.stockduel.gamebox.eth", count: 2 },
      { kind: "cup", game: "quick-draw", name: "cup-2.quickdraw.gamebox.eth", count: 6 },
    ]);
  });

  it("holds nothing with no name, and leads nothing once a championship has ended", () => {
    expect(honoursOf(null, boards, NOW)).toEqual([]);
    expect(honoursOf("orbit.gamebox.eth", boards, NOW + 60_000)).toEqual([]);
  });
});
