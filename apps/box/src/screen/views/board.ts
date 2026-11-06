// The board on Home and Attract: a glass panel right of the core with each game's title and championship, game by
// game, so a championship is never shown apart from the game that scores it. Under each game: TITLE, who holds it
// (with the streak) and the time left on it, and the title's ENS name resolving to its holder's; CUP, the open championship with its leader and countdown (ENDED once
// scoring stops, until the admin closes it; a championship closed in the last hour with its winner). Read from the
// Box's `GET /api/board` every 4 s and at once when a result is paid; the clocks count down every second in between.
// Where there is no board (the simulator in a browser, or a Box with no RPC) the panel never shows.
import { formatSeconds } from "@egb/shared/admin";
import { gameOfLabel } from "../../core/catalogue.ts";
import type { BoxLink, PlayFor } from "../../core/types.ts";
import { BOARD_PATH, type AdminCup, type AdminGame, type Board, type BoardReply } from "../../server/admin-wire.ts";
import type { Layout } from "../shell/layout.ts";
import { el, place } from "../shell/dom.ts";
import { ensName } from "../shell/ens-name.ts";

const POLL_MS = 4_000;
const TICK_MS = 1_000;
/** Games shown: the panel fits this many. */
const SHOWN = 3;
/** A closed championship stays on the board this long after its scoring stopped (seconds). */
const RECENT_S = 3_600;

/** A player by its whole ENS name (`nova.gamebox.eth`), never shortened; an address with no name as `0x8491…C763`. */
export function playerWord(name: string | null, address: string | null): string {
  if (name) return name;
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
  /** The title's or cup's own ENS name and who it resolves to now (`champion.quickdraw.gamebox.eth → nova.gamebox.eth`),
   *  or the name alone with nobody behind it, or "". */
  readonly map: string;
  /** What a tap on the line plays for (the title, or the cup while it scores), or null. */
  readonly play: PlayFor | null;
}

export interface BoardGame {
  /** The game's id on the Box, for a tap's challenge. */
  readonly id: string;
  readonly game: string;
  readonly title: BoardLine;
  readonly cup: BoardLine;
}

function titleLine(g: AdminGame, now: number): BoardLine {
  const t = g.title;
  if (!t.holder || t.expiry <= now) return { what: "UP FOR GRABS", when: "", tone: "none", map: t.name, play: "title" };
  const holder = playerWord(t.holderName, t.holder);
  return {
    what: `${holder}${t.streak > 1 ? ` ×${t.streak}` : ""}`,
    when: timeLeft(t.expiry - now),
    tone: "live",
    map: `${t.name} → ${holder}`,
    play: "title",
  };
}

function cupLine(cups: readonly AdminCup[], label: string, now: number): BoardLine {
  const mine = cups.filter((c) => c.game === label);
  const open = mine.find((c) => !c.closed);
  if (open) {
    const leader = open.leader ? playerWord(open.leader.name, open.leader.address) : null;
    const prize = open.prize === "0" ? "" : `${open.prize} USDC · `;
    if (open.ends > now) {
      const what = `${prize}${leader ? `${leader} ${open.leader?.points ?? 0} PTS` : "NO RESULTS YET"}`;
      return { what, when: timeLeft(open.ends - now), tone: "live", map: leader ? `${open.name} → ${leader}` : open.name, play: "cup" };
    }
    return { what: leader ? `${leader} WINS` : "NOBODY PLAYED", when: "ENDED", tone: "done", map: open.name, play: null };
  }
  const last = mine.find((c) => c.closed && now - c.ends < RECENT_S);
  if (last) {
    const winner = last.winner ? playerWord(last.winnerName, last.winner) : null;
    return { what: winner ? `${winner} · FOREVER` : "NOBODY PLAYED", when: "WON", tone: "done", map: winner ? `${last.name} → ${winner}` : last.name, play: null };
  }
  return { what: "NONE OPEN", when: "", tone: "none", map: "", play: null };
}

/** What the board says at `now` (unix seconds), game by game: the games this Box plays first, in rack order (any other
 *  game on chain only when the Box plays none of them). Pure, so it is tested without a DOM. */
export function boardGames(board: Board, now: number): BoardGame[] {
  const known = board.games.filter((g) => gameOfLabel(g.label) !== null);
  return (known.length ? known : board.games).slice(0, SHOWN).map((g) => ({
    id: gameOfLabel(g.label)?.id ?? g.label,
    game: (gameOfLabel(g.label)?.title ?? g.label).toUpperCase(),
    title: titleLine(g, now),
    cup: cupLine(board.cups, g.label, now),
  }));
}

/** A title or cup line: what and when, its own ENS name under it, whole; a tap plays for it when it can be. */
function lineEl(kind: string, line: BoardLine, play: (() => void) | null): HTMLElement {
  const row = el("div", "home-board-line");
  row.dataset.tone = line.tone;
  row.append(el("span", "home-board-kind", kind), ensName(line.what, "home-board-what"), el("span", "home-board-when", line.when));
  if (line.map) row.append(ensName(line.map, "home-board-map"));
  if (play) {
    row.classList.add("playable");
    row.append(el("span", "home-board-play", "PLAY ›"));
    row.addEventListener("click", play);
  }
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
  head.append(el("span", "", "TITLES & CUPS"), el("span", "home-board-live", "LIVE"), el("span", "home-board-open", "OPEN THE HALL ›"));
  head.addEventListener("click", () => link.send({ type: "hall" }));
  const games = el("div", "home-board-games");
  panel.append(head, games);

  let board: Board | null = null;
  /** The Box's clock minus the chain's, in seconds, at the last read. */
  let skew = 0;

  /** What the games were last drawn from, leaving out the times: they are redrawn only when a line changes, so names
   *  keep scrolling; the times are set in place every tick. */
  let drawn = "";

  function draw(): void {
    if (!board) return;
    const rows = boardGames(board, Date.now() / 1000 - skew);
    const key = JSON.stringify(rows.map((g) => [g.id, { ...g.title, when: "" }, { ...g.cup, when: "" }]));
    if (key === drawn) {
      const whens = games.querySelectorAll<HTMLElement>(".home-board-when");
      rows.flatMap((g) => [g.title.when, g.cup.when]).forEach((when, i) => {
        const span = whens[i];
        if (span) span.textContent = when;
      });
      return;
    }
    drawn = key;
    const tap = (g: BoardGame, line: BoardLine) => (line.play ? () => link.send({ type: "challenge", game: g.id, target: line.play as PlayFor }) : null);
    games.replaceChildren(
      ...rows.map((g) => {
        const block = el("section", "home-board-game");
        block.append(el("div", "home-board-name", g.game), lineEl("TITLE", g.title, tap(g, g.title)), lineEl("CUP", g.cup, tap(g, g.cup)));
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
