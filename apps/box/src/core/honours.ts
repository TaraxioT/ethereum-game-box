// What a player holds, by their ENS name: each game's title they hold (`champion.<game>.gamebox.eth`, owned by them)
// and each championship they lead (`<cup>.<game>.gamebox.eth`, whose address record points at its leader). Read from
// the boards; the screen shows them with the player's name wherever it shows it.
import type { Board, GameId } from "./types.ts";

export interface Honour {
  readonly kind: "title" | "cup";
  readonly game: GameId;
  /** The title's or championship's own ENS name. */
  readonly name: string;
  /** The title's streak, or the championship's points. */
  readonly count: number;
}

/** The titles `ens` holds and the championships it leads, titles first. */
export function honoursOf(ens: string | null, boards: Readonly<Record<GameId, Board>>, now: number): Honour[] {
  if (!ens) return [];
  const titles: Honour[] = [];
  const cups: Honour[] = [];
  for (const [game, board] of Object.entries(boards)) {
    if (board.title?.holder === ens) titles.push({ kind: "title", game, name: board.title.name, count: board.title.streak });
    const leader = board.cup && board.cup.ends > now ? board.cup.standings[0] : undefined;
    if (board.cup && leader?.name === ens) cups.push({ kind: "cup", game, name: board.cup.name, count: leader.points });
  }
  return [...titles, ...cups];
}

/** `champion.stockduel.gamebox.eth → nova.gamebox.eth`: the name, and the player it resolves to. */
export function mapsTo(name: string, ens: string): string {
  return `${name} → ${ens}`;
}
