// The team games in the Box's rack, in rack order, and the one Home focuses first. Built games join them through
// the library port.
import type { GameId, GameInfo, TeamGameId } from "./types.ts";
import type { LibraryPort } from "./ports.ts";

const team = (info: Omit<GameInfo, "kind" | "icon">): GameInfo => ({ ...info, kind: "team", icon: null });

export const TEAM_GAMES: readonly GameInfo[] = [
  team({ id: "quick-draw", title: "Quick Draw", players: 2, minutes: 1, stakes: [5, 10, 25], tier: "refereed", ready: true }),
  team({ id: "stock-duel", title: "Stock Duel", players: 2, minutes: 3, stakes: [5, 10, 25], tier: "refereed", ready: true }),
  team({ id: "bet-on-x", title: "Bet on X", players: 2, minutes: 5, stakes: [5, 10, 25], tier: "verified", ready: false }),
  team({ id: "b17", title: "B17", players: 2, minutes: 10, stakes: [5, 10, 25], tier: "verified", ready: false }),
];

export const DEFAULT_FOCUS: GameId = "stock-duel";

/** The library of the team games alone: it never changes. */
export function teamLibrary(): LibraryPort {
  return { games: () => TEAM_GAMES, subscribe: () => () => {} };
}

/** A game whose rules run in the core. */
export function isTeamGame(id: GameId): id is TeamGameId {
  return id === "quick-draw" || id === "stock-duel";
}

/** The stake a game offers first: its middle choice. */
export function defaultStake(info: GameInfo): number {
  const middle = info.stakes[Math.floor(info.stakes.length / 2)];
  if (middle === undefined) throw new RangeError(`${info.id} offers no stakes`);
  return middle;
}
