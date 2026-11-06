// What a match on Stake is played for, in words: a headline (the pot), what else the win takes (the title, points in
// the cup and its countdown), and the line under them (the stake each, and the title's or cup's ENS name with the
// player it resolves to: its holder, or its leader with the points and prize), which scrolls when it is long. Pure, so
// it is tested without a DOM; Stake's plate draws it every second.
import { stakeOf } from "../../core/catalogue.ts";
import type { Board, BoxState } from "../../core/types.ts";
import { clock } from "./refund.ts";

export interface OnTheLine {
  /** The pot: `WINNER TAKES 40 USDC`. */
  readonly head: string;
  /** What else the win takes: `+ THE STOCK DUEL TITLE`, `+ 3 PTS IN CUP-1921 · 03:12 LEFT`. */
  readonly plus: string;
  /** The stake each, and the ENS name of what is on the line resolving to its player. */
  readonly detail: string;
}

/** `cup-1921.stockduel.gamebox.eth` as `CUP-1921`. */
export const cupLabel = (name: string): string => (name.split(".")[0] ?? name).toUpperCase();

/** The open championship, while it still scores at `now`. */
export function liveCup(board: Board | null, now: number): Board["cup"] {
  return board?.cup && board.cup.ends > now ? board.cup : null;
}

/** `champion.stockduel.gamebox.eth → nova.gamebox.eth ×2`, or that nobody holds it yet. */
function titleMap(board: Board | null): string {
  const t = board?.title;
  return t ? `${t.name} → ${t.holder}${t.streak > 1 ? ` ×${t.streak}` : ""}` : "NOBODY HOLDS THE TITLE YET";
}

export function onTheLine(state: Pick<BoxState, "stake" | "playFor" | "board">, game: string, now: number): OnTheLine {
  const { board } = state;
  const cup = liveCup(board, now);
  const each = stakeOf(state.playFor, state.stake);
  const head = `WINNER TAKES ${each * 2} USDC`;
  const theTitle = `+ THE ${game.toUpperCase()} TITLE`;
  switch (state.playFor) {
    case "usdc":
      return { head, plus: `${theTitle}${cup ? ` + 3 PTS IN ${cupLabel(cup.name)}` : ""}`, detail: `${each} USDC EACH · EVERY WIN ON CHAIN TAKES THE TITLE` };
    case "title":
      return { head, plus: theTitle, detail: `${each} USDC EACH · ${titleMap(board)}` };
    case "cup": {
      if (!cup) return { head: "THE CUP HAS CLOSED", plus: "", detail: "PICK THE TITLE OR A USDC STAKE" };
      const leader = cup.standings[0];
      const lead = leader ? `${cup.name} → ${leader.name} · ${leader.points} PTS` : `${cup.name} · NO RESULTS YET`;
      const prize = cup.prize > 0 ? ` · ${cup.prize} USDC PRIZE` : "";
      return { head, plus: `+ 3 PTS IN ${cupLabel(cup.name)} · ${clock(cup.ends - now)} LEFT`, detail: `${each} USDC EACH · ${lead}${prize}` };
    }
  }
}
