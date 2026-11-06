// What a match on Stake is played for, in words: a headline (the pot, the title or the championship) and the line
// under it (who holds the title, who leads the championship and how long it has left). Pure, so it is tested without
// a DOM; Stake's plate draws it every second.
import type { Board, BoxState } from "../../core/types.ts";
import { clock } from "./refund.ts";

export interface OnTheLine {
  readonly head: string;
  readonly detail: string;
}

/** `nova.gamebox.eth` as `NOVA`; a badge with no name, by its address, as `0x24af…17d4`. */
export const shortName = (name: string): string =>
  /^0x[0-9a-fA-F]{40}$/.test(name) ? `${name.slice(0, 6)}…${name.slice(-4)}` : name.replace(/\.gamebox\.eth$/, "").toUpperCase();

/** `cup-1921.stockduel.gamebox.eth` as `CUP-1921`. */
export const cupLabel = (name: string): string => (name.split(".")[0] ?? name).toUpperCase();

/** The open championship, while it still scores at `now`. */
export function liveCup(board: Board | null, now: number): Board["cup"] {
  return board?.cup && board.cup.ends > now ? board.cup : null;
}

function holder(board: Board | null): string {
  const t = board?.title;
  if (!t) return "NOBODY HOLDS THE TITLE YET";
  return `${shortName(t.holder)} HOLDS THE TITLE${t.streak > 1 ? ` ×${t.streak}` : ""}`;
}

export function onTheLine(state: Pick<BoxState, "stake" | "playFor" | "board">, game: string, now: number): OnTheLine {
  const { board } = state;
  const cup = liveCup(board, now);
  switch (state.playFor) {
    case "usdc":
      return {
        head: `WINNER TAKES ${state.stake * 2} USDC`,
        detail: `${state.stake} USDC EACH · THE WIN ALSO TAKES THE TITLE${cup ? ` AND SCORES ${cupLabel(cup.name)}` : ""}`,
      };
    case "title":
      return { head: `FOR THE ${game.toUpperCase()} TITLE`, detail: `${holder(board)} · NO USDC STAKED` };
    case "cup": {
      if (!cup) return { head: "THE CHAMPIONSHIP HAS CLOSED", detail: "PICK THE TITLE OR A USDC STAKE" };
      const leader = cup.standings[0];
      const lead = leader ? `${shortName(leader.name)} LEADS · ${leader.points} PTS` : "NO RESULTS YET";
      const prize = cup.prize > 0 ? ` · ${cup.prize} USDC PRIZE` : "";
      return { head: `FOR ${cupLabel(cup.name)}`, detail: `WIN 3 · DRAW 1 · ${lead}${prize} · ${clock(cup.ends - now)} LEFT` };
    }
  }
}
