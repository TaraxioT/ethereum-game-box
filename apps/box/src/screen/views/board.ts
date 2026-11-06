// The board on Home and Attract: a glass panel right of the core with the live champions (each game's title holder,
// streak and time left) and the championships (the open ones with their leader, prize and time left; else the last
// one closed and its winner). Read from the Box's `GET /api/board` every 15 s; the clocks count down every second in
// between. Where there is no board (the simulator in a browser, or a Box with no RPC) the panel never shows.
import { formatSeconds } from "@egb/shared/admin";
import { BOARD_PATH, type AdminCup, type Board, type BoardReply } from "../../server/admin-wire.ts";
import type { Layout } from "../shell/layout.ts";
import { el, place } from "../shell/dom.ts";

const POLL_MS = 15_000;
const TICK_MS = 1_000;
/** Lines of each list. */
const SHOWN = 3;

/** `nova.gamebox.eth` as `NOVA`; an address as `0x8491…C763`. */
export function playerWord(name: string | null, address: string | null): string {
  if (name) return name.replace(/\.gamebox\.eth$/, "").toUpperCase();
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

/** `4M 10S`, rounded down to whole minutes past an hour. */
function left(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return formatSeconds(s >= 3_600 ? s - (s % 60) : s).toUpperCase();
}

/** One line of the board: the game or championship, who holds or leads it, and the time left (or none). */
export type BoardRow = readonly [game: string, who: string, when: string];

/** What the board says at `now` (unix seconds): the live champions, then the open championships (else the last one
 *  closed). Pure, so it is tested without a DOM. */
export function boardRows(board: Board, now: number): { champions: BoardRow[]; cups: BoardRow[] } {
  const champions = board.games
    .filter((g) => g.title.holder && g.title.expiry > now)
    .slice(0, SHOWN)
    .map((g): BoardRow => [
      g.label.toUpperCase(),
      `${playerWord(g.title.holderName, g.title.holder)}${g.title.streak > 1 ? ` ×${g.title.streak}` : ""}`,
      left(g.title.expiry - now),
    ]);
  const cupRow = (c: AdminCup): BoardRow => {
    const leader = c.leader ? playerWord(c.leader.name, c.leader.address) : null;
    if (c.ends > now) {
      return [c.label.toUpperCase(), leader ? `${leader} ${c.leader?.points ?? 0} PTS` : "NO GAMES YET", `${c.prize === "0" ? "" : `${c.prize} USDC · `}${left(c.ends - now)}`];
    }
    return [c.label.toUpperCase(), leader ? `${leader} WINS` : "NOBODY PLAYED", "ENDED"];
  };
  const open = board.cups.filter((c) => !c.closed).slice(0, SHOWN);
  const last = board.cups.find((c) => c.closed);
  const cups: BoardRow[] = open.length
    ? open.map(cupRow)
    : last
      ? [[last.label.toUpperCase(), last.winner ? `WON BY ${playerWord(last.winnerName, last.winner)}` : "NOBODY PLAYED", "CLOSED"]]
      : [];
  return { champions, cups };
}

function line([game, who, when]: BoardRow): HTMLElement {
  const li = el("li", "home-board-line");
  li.append(el("span", "home-board-game", game), el("span", "home-board-who", who), el("span", "home-board-when", when));
  return li;
}

function none(text: string): HTMLElement {
  const li = el("li", "home-board-line");
  li.append(el("span", "home-board-none", text));
  return li;
}

export interface BoardPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

/** The panel at `layout.board` (none in portrait, which has no room for it). */
export function createBoardPanel(layout: Layout): BoardPanel | null {
  if (!layout.board) return null;
  const panel = document.createElement("egb-panel");
  panel.classList.add("home-board");
  panel.hidden = true;
  place(panel, layout.board);
  const champions = el("ul", "home-board-list");
  const cups = el("ul", "home-board-list");
  panel.append(el("div", "home-board-head", "CHAMPIONS"), champions, el("div", "home-board-head", "CHAMPIONSHIPS"), cups);

  let board: Board | null = null;
  /** The Box's clock minus the chain's, in seconds, at the last read. */
  let skew = 0;

  function draw(): void {
    if (!board) return;
    const now = Date.now() / 1000 - skew;
    const rows = boardRows(board, now);
    champions.replaceChildren(...(rows.champions.length ? rows.champions.map(line) : [none("NO CHAMPION YET · WIN A MATCH")]));
    cups.replaceChildren(...(rows.cups.length ? rows.cups.map(line) : [none("NONE OPEN")]));
  }

  async function read(): Promise<void> {
    try {
      const res = await fetch(BOARD_PATH, { cache: "no-store" });
      if (!res.ok) return;
      const reply = (await res.json()) as BoardReply;
      if (!reply.available || !reply.board) return;
      board = reply.board;
      skew = Date.now() / 1000 - board.now;
      panel.hidden = false;
      draw();
    } catch {
      // No Box behind this page (the simulator): no board.
    }
  }

  void read();
  const poll = setInterval(() => void read(), POLL_MS);
  const tick = setInterval(draw, TICK_MS);
  return {
    el: panel,
    dispose() {
      clearInterval(poll);
      clearInterval(tick);
    },
  };
}
