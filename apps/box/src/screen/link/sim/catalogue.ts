// The games in the Box's rack, in rack order, and the one Home focuses first.
import type { GameId, GameInfo } from "../types.ts";

export const GAMES: readonly GameInfo[] = [
  { id: "quick-draw", title: "Quick Draw", players: 2, minutes: 1, stakes: [5, 10, 25], tier: "refereed", ready: true },
  { id: "stock-duel", title: "Stock Duel", players: 2, minutes: 3, stakes: [5, 10, 25], tier: "refereed", ready: true },
  { id: "bet-on-x", title: "Bet on X", players: 2, minutes: 5, stakes: [5, 10, 25], tier: "verified", ready: false },
  { id: "b17", title: "B17", players: 2, minutes: 10, stakes: [5, 10, 25], tier: "verified", ready: false },
];

export const DEFAULT_FOCUS: GameId = "stock-duel";

export function gameInfo(id: GameId): GameInfo {
  const info = GAMES.find((game) => game.id === id);
  if (!info) throw new RangeError(`unknown game ${id}`);
  return info;
}

/** The stake a game offers first: its middle choice. */
export function defaultStake(info: GameInfo): number {
  const middle = info.stakes[Math.floor(info.stakes.length / 2)];
  if (middle === undefined) throw new RangeError(`${info.id} offers no stakes`);
  return middle;
}
