// What a match on Stake is played for, in words: a headline (the pot, and the title or the championship with it) and
// the line under it (the stake each, and the title's or championship's ENS name with the player it resolves to: its
// holder, or its leader with the points and countdown). Pure, so it is tested without a DOM; Stake's plate draws it
// every second.
import { stakeOf } from "../../core/catalogue.ts";
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

/** `champion.stockduel.gamebox.eth → nova.gamebox.eth ×2`, or that nobody holds it yet. */
function titleMap(board: Board | null): string {
  const t = board?.title;
  return t ? `${t.name} → ${t.holder}${t.streak > 1 ? ` ×${t.streak}` : ""}` : "NOBODY HOLDS THE TITLE YET";
}

export function onTheLine(state: Pick<BoxState, "stake" | "playFor" | "board">, game: string, now: number): OnTheLine {
  const { board } = state;
  const cup = liveCup(board, now);
  const each = stakeOf(state.playFor, state.stake);
  const pot = `WINNER TAKES ${each * 2} USDC`;
  switch (state.playFor) {
    case "usdc":
      return {
        head: pot,
        detail: `${each} USDC EACH · THE WIN ALSO TAKES THE TITLE${cup ? ` AND SCORES ${cupLabel(cup.name)}` : ""}`,
      };
    case "title":
      return { head: `${pot} + THE ${game.toUpperCase()} TITLE`, detail: `${each} USDC EACH · ${titleMap(board)}` };
    case "cup": {
      if (!cup) return { head: "THE CHAMPIONSHIP HAS CLOSED", detail: "PICK THE TITLE OR A USDC STAKE" };
      const leader = cup.standings[0];
      const lead = leader ? `${cup.name} → ${leader.name} · ${leader.points} PTS` : `${cup.name} · NO RESULTS YET`;
      const prize = cup.prize > 0 ? ` · ${cup.prize} USDC PRIZE` : "";
      return { head: `${pot} + 3 PTS IN ${cupLabel(cup.name)}`, detail: `${each} USDC EACH · ${lead}${prize} · ${clock(cup.ends - now)} LEFT` };
    }
  }
}
