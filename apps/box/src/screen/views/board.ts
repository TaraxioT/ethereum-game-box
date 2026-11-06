// The board on Home and Attract: a glass panel right of the core with each game's title and championship, game by
// game, so a championship is never shown apart from the game that scores it. Under each game: TITLE, who holds it
// (with the streak) and the time left on it; CUP, the open championship with its leader and countdown (ENDED once
// scoring stops, until the admin closes it; a championship closed in the last hour with its winner). Read from the
// Box's `GET /api/board` every 4 s and at once when a result is paid; the clocks count down every second in between.
// Where there is no board (the simulator in a browser, or a Box with no RPC) the panel never shows.
import { formatSeconds } from "@egb/shared/admin";
import { gameOfLabel } from "../../core/catalogue.ts";
import type { BoxLink } from "../../core/types.ts";
import { BOARD_PATH, type AdminCup, type AdminGame, type Board, type BoardReply } from "../../server/admin-wire.ts";
import type { Layout } from "../shell/layout.ts";
import { el, place } from "../shell/dom.ts";

const POLL_MS = 4_000;
const TICK_MS = 1_000;
/** Games shown: the panel fits this many. */
const SHOWN = 3;
/** A closed championship stays on the board this long after its scoring stopped (seconds). */
const RECENT_S = 3_600;

/** `nova.gamebox.eth` as `NOVA`; an address as `0x8491…C763`. */
export function playerWord(name: string | null, address: string | null): string {
  if (name) return name.replace(/\.gamebox\.eth$/, "").toUpperCase();
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

/** `4M 10S`, rounded down to whole minutes past an hour. */
export function timeLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return formatSeconds(s >= 3_600 ? s - (s % 60) : s).toUpperCase();
}

/** One line under a game: what (the holder, the championship), and when (time left, ENDED, CLOSED) or nothing. */
export interface BoardLine {
  readonly what: string;
  readonly when: string;
  /** `live`: held or scoring now. `done`: ended or closed. `none`: nobody holds it, nothing open. */
  readonly tone: "live" | "done" | "none";
}

export interface BoardGame {
  readonly game: string;
  readonly title: BoardLine;
  readonly cup: BoardLine;
}

function titleLine(g: AdminGame, now: number): BoardLine {
  const t = g.title;
  if (!t.holder || t.expiry <= now) return { what: "UP FOR GRABS", when: "", tone: "none" };
  return { what: `${playerWord(t.holderName, t.holder)}${t.streak > 1 ? ` ×${t.streak}` : ""}`, when: timeLeft(t.expiry - now), tone: "live" };
}

function cupLine(cups: readonly AdminCup[], label: string, now: number): BoardLine {
  const mine = cups.filter((c) => c.game === label);
  const open = mine.find((c) => !c.closed);
  if (open) {
    const leader = open.leader ? playerWord(open.leader.name, open.leader.address) : null;
    const name = `${open.label.toUpperCase()}${open.prize === "0" ? "" : ` · ${open.prize} USDC`}`;
    if (open.ends > now) return { what: `${name} · ${leader ? `${leader} ${open.leader?.points ?? 0} PTS` : "NO RESULTS YET"}`, when: timeLeft(open.ends - now), tone: "live" };
    return { what: `${open.label.toUpperCase()} · ${leader ? `${leader} WINS` : "NOBODY PLAYED"}`, when: "ENDED", tone: "done" };
  }
  const last = mine.find((c) => c.closed && now - c.ends < RECENT_S);
  if (last) return { what: last.label.toUpperCase(), when: last.winner ? `WON BY ${playerWord(last.winnerName, last.winner)}` : "NOBODY PLAYED", tone: "done" };
  return { what: "NONE OPEN", when: "", tone: "none" };
}

/** What the board says at `now` (unix seconds), game by game: the games this Box plays first, in rack order (any other
 *  game on chain only when the Box plays none of them). Pure, so it is tested without a DOM. */
export function boardGames(board: Board, now: number): BoardGame[] {
  const known = board.games.filter((g) => gameOfLabel(g.label) !== null);
  return (known.length ? known : board.games).slice(0, SHOWN).map((g) => ({
    game: (gameOfLabel(g.label)?.title ?? g.label).toUpperCase(),
    title: titleLine(g, now),
    cup: cupLine(board.cups, g.label, now),
  }));
}

function lineEl(kind: string, line: BoardLine): HTMLElement {
  const row = el("div", "home-board-line");
  row.dataset.tone = line.tone;
  row.append(el("span", "home-board-kind", kind), el("span", "home-board-what", line.what), el("span", "home-board-when", line.when));
  return row;
}

export interface BoardPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

/** The panel at `layout.board` (none in portrait, which has no room for it). */
export function createBoardPanel(layout: Layout, link: BoxLink): BoardPanel | null {
  if (!layout.board) return null;
  const panel = document.createElement("egb-panel");
  panel.classList.add("home-board");
  panel.hidden = true;
  place(panel, layout.board);
  const head = el("div", "home-board-head");
  head.append(el("span", "", "TITLES & CHAMPIONSHIPS"), el("span", "home-board-live", "LIVE"));
  const games = el("div", "home-board-games");
  panel.append(head, games);

  let board: Board | null = null;
  /** The Box's clock minus the chain's, in seconds, at the last read. */
  let skew = 0;

  function draw(): void {
    if (!board) return;
    const rows = boardGames(board, Date.now() / 1000 - skew);
    games.replaceChildren(
      ...rows.map((g) => {
        const block = el("section", "home-board-game");
        block.append(el("div", "home-board-name", g.game), lineEl("TITLE", g.title), lineEl("CUP", g.cup));
        return block;
      }),
    );
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
  // A result paid moves the title and scores the championship: read it now rather than at the next poll.
  const unsubscribe = link.subscribe((_, event) => {
    if (event.type === "tx" && event.tx.kind === "settle" && event.tx.step === "paid") void read();
  });
  return {
    el: panel,
    dispose() {
      clearInterval(poll);
      clearInterval(tick);
      unsubscribe();
    },
  };
}
