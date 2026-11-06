// The hall: every title and cup and the leaderboard on one page, each a name on ENS, and each played for from its card.
// Three panels under the machine's top band:
// - TITLES, one card per game on chain: the title's ENS name, who it resolves to (big), the streak and the time left
//   on it (it lapses by itself, with no transaction: EXPIRES), or VACANT; PLAY FOR IT at the title's stake.
// - CUPS: each game's open cup (its ENS name, prize, countdown and top three, PLAY FOR IT at the cup's stake, or ENDED
//   until it is closed), then WON FOREVER: the closed cups, each name now its winner's with no expiry.
// - LEADERBOARD: `gamebox.eth`'s `leaderboard` record, the top ten over every game, the seated players lit.
// Every ENS name is shown whole (`ensName`: one that doesn't fit drifts sideways). A tap on either station takes a seat,
// as on Home, so PLAY FOR IT goes straight to Stake once both are seated. The boards are read every few seconds while
// the hall shows; the countdowns run every second without redrawing a card. BACK returns Home.
import type { Board, BoxState, GameInfo, Leader, PlayFor } from "../../core/types.ts";
import { MODE_STAKES } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import type { Rect } from "../shell/layout.ts";
import { el, place } from "../shell/dom.ts";
import { ensName } from "../shell/ens-name.ts";
import { timeLeft } from "./board.ts";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
/** Closed cups listed under WON FOREVER, newest first. */
const WON_SHOWN = 4;

interface HallLayout {
  readonly head: Rect;
  readonly titles: Rect;
  readonly cups: Rect;
  readonly leaders: Rect;
  readonly keys: Rect;
}

const LANDSCAPE: HallLayout = {
  head: { x: 40, y: 128, w: 1200, h: 40 },
  titles: { x: 40, y: 176, w: 400, h: 456 },
  cups: { x: 456, y: 176, w: 380, h: 456 },
  leaders: { x: 852, y: 176, w: 388, h: 456 },
  keys: { x: 340, y: 652, w: 600, h: 76 },
};

const PORTRAIT: HallLayout = {
  head: { x: 24, y: 150, w: 672, h: 40 },
  titles: { x: 24, y: 196, w: 672, h: 250 },
  cups: { x: 24, y: 458, w: 672, h: 250 },
  leaders: { x: 24, y: 720, w: 672, h: 230 },
  keys: { x: 60, y: 966, w: 600, h: 76 },
};

const shift = (r: Rect, dx: number): Rect => ({ ...r, x: r.x + dx });

/** The games a card can be played for: the team games on chain, in rack order. */
const chainGames = (state: BoxState): GameInfo[] => state.games.filter((g) => g.kind === "team" && state.boards[g.id] !== undefined);

/** A ticking countdown to `ends` (Box ms): `tick` keeps its text current without redrawing its card. */
function countdown(ends: number, prefix: string): HTMLElement {
  const span = el("span", "hall-left");
  span.dataset.ends = String(ends);
  span.dataset.prefix = prefix;
  return span;
}

export function hallView(ctx: ViewContext): View {
  const { link, sound } = ctx;
  const base = ctx.layout.orientation === "portrait" ? PORTRAIT : LANDSCAPE;
  const dx = ctx.layout.inset;
  const root = el("div", "page hall");

  const head = el("div", "hall-head");
  place(head, shift(base.head, dx));
  head.append(
    el("span", "hall-head-title", "TITLES & CUPS"),
    el("span", "hall-head-live", "LIVE ON ENS"),
    el("span", "hall-head-rule", "titles expire · cups are forever · tap your badge, then play"),
  );

  const panel = (rect: Rect, kicker: string, className: string): { readonly frame: EgbPanel; readonly body: HTMLElement } => {
    const frame = document.createElement("egb-panel") as EgbPanel;
    frame.classList.add("hall-panel", className);
    place(frame, shift(rect, dx));
    const body = el("div", "hall-body");
    frame.append(el("div", "hall-kicker", kicker), body);
    return { frame, body };
  };
  const titles = panel(base.titles, "TITLES · EXPIRE", "hall-titles");
  const cups = panel(base.cups, "CUPS · FOREVER", "hall-cups");
  const leaders = panel(base.leaders, "LEADERBOARD · GAMEBOX.ETH", "hall-leaders");

  const keys = el("div", "page-keys hall-keys");
  place(keys, shift(base.keys, dx));
  const back = document.createElement("egb-key") as EgbKey;
  back.setAttribute("variant", "ghost");
  back.textContent = "BACK";
  back.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "back" });
  });
  keys.append(back);
  root.append(head, titles.frame, cups.frame, leaders.frame, keys);

  /** PLAY FOR IT on a card: the match for `target` at its stake. */
  const playKey = (game: GameInfo, target: Exclude<PlayFor, "usdc">, enabled: boolean): EgbKey => {
    const k = document.createElement("egb-key") as EgbKey;
    k.classList.add("hall-play");
    k.textContent = `PLAY FOR IT · ${MODE_STAKES[target]} USDC`;
    k.toggleAttribute("disabled", !enabled || !game.ready);
    k.addEventListener("click", () => {
      sound.play("ui-select");
      link.send({ type: "challenge", game: game.id, target });
    });
    return k;
  };

  function titleCard(game: GameInfo, board: Board, now: number): HTMLElement {
    const card = el("section", "hall-card");
    const t = board.title && board.title.expires > now ? board.title : null;
    const top = el("div", "hall-card-top");
    top.append(el("span", "hall-game", game.title.toUpperCase()), t ? countdown(t.expires, "EXPIRES IN ") : el("span", "hall-tag", "VACANT"));
    card.append(top);
    if (t) {
      card.append(
        ensName(t.name, "hall-name"),
        ensName(t.holder, "hall-holder"),
        el("div", "hall-meta", `holds it${t.streak > 1 ? ` · ${t.streak} wins in a row` : ""} · soulbound`),
      );
    } else {
      card.append(el("div", "hall-empty", "UP FOR GRABS"), el("div", "hall-meta", "win one match and it's yours, on ENS"));
    }
    card.append(playKey(game, "title", true));
    return card;
  }

  function cupCard(game: GameInfo, cup: NonNullable<Board["cup"]>, now: number): HTMLElement {
    const live = cup.ends > now;
    const card = el("section", `hall-card${live ? "" : " ended"}`);
    const top = el("div", "hall-card-top");
    top.append(
      el("span", "hall-game", `${game.title.toUpperCase()}${cup.prize > 0 ? ` · ${cup.prize} USDC PRIZE` : ""}`),
      live ? countdown(cup.ends, "ENDS IN ") : el("span", "hall-tag", "ENDED"),
    );
    const rows = el("ol", "hall-rows");
    rows.append(
      ...(cup.standings.length === 0
        ? [el("li", "empty", "no results yet · win 3, draw 1")]
        : cup.standings.slice(0, 3).map((row, i) => {
            const li = el("li");
            li.append(el("span", "rank", ORDINAL[i] ?? ""), ensName(row.name, "who"), el("span", "pts", `${row.points} PTS`));
            return li;
          })),
    );
    card.append(top, ensName(cup.name, "hall-name"), rows, playKey(game, "cup", live));
    return card;
  }

  function wonList(state: BoxState): HTMLElement | null {
    const won = chainGames(state).flatMap((g) => state.boards[g.id]?.won ?? []).slice(0, WON_SHOWN);
    if (won.length === 0) return null;
    const list = el("ol", "hall-rows hall-won");
    list.append(
      ...won.map((w) => {
        const li = el("li");
        const pair = el("span", "who");
        pair.append(ensName(w.name, "hall-won-name"), ensName(`→ ${w.winner}`, "hall-won-winner"));
        li.append(el("span", "rank", "★"), pair, el("span", "pts", w.prize > 0 ? `${w.prize} USDC` : "FOREVER"));
        return li;
      }),
    );
    const block = el("div", "hall-won-block");
    block.append(el("div", "hall-kicker", "WON FOREVER · NO EXPIRY, NO PARENT"), list);
    return block;
  }

  function leaderRows(top: readonly Leader[], seated: readonly string[]): HTMLElement {
    const list = el("ol", "hall-rows hall-board");
    list.append(
      ...(top.length === 0
        ? [el("li", "empty", "no results yet · every match counts")]
        : top.map((row, i) => {
            const li = el("li", seated.includes(row.name) ? "you" : "");
            li.append(
              el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
              ensName(row.name, "who"),
              el("span", "pts", `${row.wins}W ${row.losses}L${row.streak > 0 ? ` · ×${row.streak}` : ""}`),
            );
            return li;
          })),
    );
    return list;
  }

  /** What each panel was last drawn from: a panel is redrawn only when it changes, so names keep their drift. */
  const drawn = { titles: "", cups: "", leaders: "" };

  function draw(state: BoxState): void {
    const now = link.now();
    const games = chainGames(state);
    const live = (ends: number | undefined): boolean => ends !== undefined && ends > now;

    const titleKey = JSON.stringify(games.map((g) => [g.id, g.ready, state.boards[g.id]?.title, live(state.boards[g.id]?.title?.expires)]));
    if (titleKey !== drawn.titles) {
      drawn.titles = titleKey;
      titles.body.replaceChildren(
        ...(games.length ? games.map((g) => titleCard(g, state.boards[g.id] as Board, now)) : [el("div", "hall-empty", "READING SEPOLIA…")]),
      );
    }

    const open = games.flatMap((g) => {
      const cup = state.boards[g.id]?.cup;
      return cup ? [[g, cup] as const] : [];
    });
    const cupKey = JSON.stringify([open.map(([g, c]) => [g.id, g.ready, c, live(c.ends)]), games.map((g) => state.boards[g.id]?.won)]);
    if (cupKey !== drawn.cups) {
      drawn.cups = cupKey;
      const won = wonList(state);
      cups.body.replaceChildren(
        ...(open.length
          ? open.map(([g, c]) => cupCard(g, c, now))
          : [el("div", "hall-empty", "NO CUP OPEN"), el("div", "hall-meta", "the Box's admin opens one from ⚙ · OPEN A CUP")]),
        ...(won ? [won] : []),
      );
    }

    const top = games.map((g) => state.boards[g.id]?.leaders).find((l) => l !== undefined) ?? [];
    const seated = state.seats.flatMap((s) => (s.ens ? [s.ens] : []));
    const leaderKey = JSON.stringify([top, seated]);
    if (leaderKey !== drawn.leaders) {
      drawn.leaders = leaderKey;
      leaders.body.replaceChildren(leaderRows(top, seated));
    }
    tick();
  }

  /** The countdowns move every second; a card that runs out is redrawn by the next `draw`. */
  function tick(): void {
    const now = link.now();
    for (const span of root.querySelectorAll<HTMLElement>(".hall-left")) {
      const left = (Number(span.dataset.ends) - now) / 1000;
      span.textContent = left > 0 ? `${span.dataset.prefix ?? ""}${timeLeft(left)}` : "TIME'S UP";
    }
  }
  const ticker = setInterval(() => {
    tick();
    draw(link.state());
  }, 1000);

  return {
    el: root,
    update(state) {
      draw(state);
    },
    dispose() {
      clearInterval(ticker);
    },
  };
}
