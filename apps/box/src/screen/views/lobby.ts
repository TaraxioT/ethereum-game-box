// The lobby: a badge tapped on either station shows its card, read from chain: its player name, or (with none yet) a
// name field holding the proposed label, which the player may type over (the Pi's touch keyboard or a keyboard; the
// label rule is checked as they type), with ANOTHER and CLAIM (Enter claims too). The Box vouches for the badge with its
// own key: a badge can't sign a claim;
// its stats over every game, from its name's `stats` record (the win streak, wins, losses, played, the best streak and
// its place on the leaderboard); its USDC and TOP UP 100 USDC. Beside it, the game's title
// (`champion.<game>.gamebox.eth`, its holder and streak), its open cup (the standings, the prize and a countdown to the
// close) and the leaderboard over every game (`gamebox.eth`'s `leaderboard` record), read through the Universal
// Resolver every few seconds while the lobby shows. The transaction bar follows each claim and top-up. BACK returns
// Home, or to Stake when a short balance sent the player here.
import type { Board, BoxState, Leader, Lobby, PlayerRecord } from "../../core/types.ts";
import { DEFAULT_FOCUS } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { labelProblem } from "@egb/shared/names";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { clock } from "./refund.ts";
import { cupLabel, shortName } from "./play-for.ts";
import { honoursOf } from "../../core/honours.ts";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];
/** Leaderboard rows the board shows. */
const LEADERS_SHOWN = 5;

const usdc = (amount: number): string => `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;

export function lobbyView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page lobby");

  const card = document.createElement("egb-panel") as EgbPanel;
  card.classList.add("lobby-card");
  place(card, page.seats[0]);
  const kicker = el("div", "lobby-kicker", "PLAYER");
  const name = el("div", "lobby-name");
  // The name to claim, typed over the proposal. Keys typed here are the field's alone.
  const field = document.createElement("input");
  Object.assign(field, { type: "text", className: "lobby-input", maxLength: 32, autocomplete: "off", spellcheck: false, placeholder: "your-name" });
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("enterkeyhint", "done");
  field.setAttribute("aria-label", "the name to claim");
  const proposal = el("label", "lobby-claim");
  proposal.append(field, el("span", "lobby-suffix", ".gamebox.eth"));
  const fieldHint = el("div", "lobby-hint");
  const balance = el("div", "lobby-balance");
  const held = el("div", "lobby-honours");
  const statsHead = el("div", "lobby-kicker", "STATS");
  const stats = el("div", "lobby-stats");
  const statsNote = el("div", "lobby-ens");
  card.append(kicker, name, proposal, fieldHint, held, statsHead, stats, statsNote, balance);

  const board = document.createElement("egb-panel") as EgbPanel;
  board.classList.add("lobby-board");
  place(board, page.seats[1]);
  const gameHead = el("div", "lobby-game");
  const title = el("div", "lobby-holder");
  const titleName = el("div", "lobby-ens");
  const cup = el("div", "lobby-cup");
  const standings = el("ol", "lobby-standings");
  const leaders = el("ol", "lobby-standings lobby-leaders");
  board.append(
    gameHead,
    el("div", "lobby-kicker", "TITLE"),
    title,
    titleName,
    el("div", "lobby-kicker", "CUP"),
    cup,
    standings,
    el("div", "lobby-kicker", "LEADERBOARD · GAMEBOX.ETH"),
    leaders,
  );

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const keys = el("div", "page-keys lobby-keys");
  place(keys, page.keys);
  const key = (text: string, command: "back" | "propose" | "claim" | "topup", variant?: string): EgbKey => {
    const k = document.createElement("egb-key") as EgbKey;
    if (variant) k.setAttribute("variant", variant);
    k.textContent = text;
    k.addEventListener("click", () => {
      sound.play(command === "back" ? "ui-back" : "ui-select");
      link.send(command === "claim" ? { type: "claim", label: field.value } : { type: command });
    });
    return k;
  };
  const back = key("BACK", "back", "ghost");
  const another = key("ANOTHER", "propose", "ghost");
  const claim = key("CLAIM", "claim");
  const topup = key("TOP UP 100 USDC", "topup");
  keys.append(back, another, claim, topup);
  root.append(card, board, plate, keys);

  /** The badge and proposal the field was last filled for: a new one refills it, typing keeps it. */
  let filledFor = "";
  field.addEventListener("input", () => {
    const clean = field.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (clean !== field.value) field.value = clean;
    drawCard(link.state().lobby, link.state());
  });
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !claim.hasAttribute("disabled")) {
      field.blur();
      claim.click();
    }
  });

  function drawCard(lobby: Lobby, state: BoxState): void {
    const claiming = state.txs.some((tx) => tx.kind === "claim" && tx.step !== "paid" && tx.step !== "failed");
    const topping = state.txs.some((tx) => tx.kind === "topup" && tx.step !== "paid" && tx.step !== "failed");
    const c = lobby.card;
    card.toggleAttribute("lit", lobby.badge !== null);
    const naming = Boolean(lobby.badge && c && !c.name);
    if (!lobby.badge) {
      name.textContent = "—";
      balance.textContent = "";
    } else {
      name.textContent = c === null ? "reading…" : (c.name ?? "NO NAME YET");
      name.classList.toggle("none", c !== null && c.name === null);
      balance.textContent = c ? usdc(c.balance) : "… USDC";
    }
    proposal.hidden = !naming;
    fieldHint.hidden = !naming;
    const fillFor = naming ? `${lobby.badge?.address}|${lobby.proposal ?? ""}` : "";
    if (fillFor !== filledFor) {
      filledFor = fillFor;
      field.value = naming ? (lobby.proposal ?? "") : "";
    }
    field.disabled = claiming;
    const problem = labelProblem(field.value);
    fieldHint.textContent = problem ? `a name needs ${problem}` : "type a name, or keep this one · ENTER OR CLAIM";
    fieldHint.classList.toggle("bad", problem !== null && field.value !== "");
    // What this player holds: each title and championship by its own ENS name, resolving to theirs.
    held.replaceChildren(
      ...honoursOf(c?.name ?? null, state.boards, link.now()).map((h) => {
        const row = el("div", `lobby-honour ${h.kind}`);
        row.append(el("b", "", h.kind === "title" ? `♛ TITLE${h.count > 1 ? ` ×${h.count}` : ""}` : `★ LEADS · ${h.count} PTS`), el("span", "", ` ${h.name} → ${c?.name ?? ""}`));
        return row;
      }),
    );
    drawStats(c?.name ?? null, c?.record ?? null, state.board?.leaders ?? []);
    another.toggleAttribute("disabled", !naming || claiming);
    claim.toggleAttribute("disabled", !naming || claiming || problem !== null);
    topup.toggleAttribute("disabled", !lobby.badge || topping);
    plate.textContent = !lobby.badge
      ? "TAP YOUR BADGE ON EITHER STATION"
      : claiming
        ? "CLAIMING YOUR NAME ON SEPOLIA…"
        : topping
          ? "TOPPING UP 100 USDC…"
          : lobby.from === "stake"
            ? `YOUR STAKE IS ${usdc(state.stake)}: TOP UP, THEN BACK`
            : "TAP ANOTHER BADGE TO SEE IT";
  }

  /** The player's stats from its name's `stats` record, and its place on the leaderboard. */
  function drawStats(ens: string | null, r: PlayerRecord | null, top: readonly Leader[]): void {
    statsHead.hidden = ens === null;
    if (!ens) {
      stats.replaceChildren();
      statsNote.textContent = "";
      return;
    }
    if (!r) {
      stats.replaceChildren(el("div", "lobby-stat none", "NO RESULTS YET"));
      statsNote.textContent = `play a match: it writes ${ens}'s stats record`;
      return;
    }
    const rank = top.findIndex((row) => row.name === ens);
    const tile = (label: string, value: string, tone = ""): HTMLElement => {
      const t = el("div", `lobby-stat ${tone}`);
      t.append(el("b", "", value), el("span", "", label));
      return t;
    };
    stats.replaceChildren(
      tile("STREAK", String(r.streak), r.streak > 0 ? "hot" : ""),
      tile("WINS", String(r.wins)),
      tile("LOSSES", String(r.losses)),
      tile("PLAYED", String(r.played)),
      tile("BEST", String(r.best)),
      tile("RANK", rank < 0 ? "—" : `#${rank + 1}`, rank === 0 ? "hot" : ""),
    );
    statsNote.textContent = `${ens} · stats record${r.draws > 0 ? ` · ${r.draws} draw${r.draws > 1 ? "s" : ""}` : ""}`;
  }

  function drawLeaders(top: readonly Leader[], you: string | null): void {
    leaders.replaceChildren(
      ...(top.length === 0
        ? [el("li", "empty", "no results yet · every match counts")]
        : top.slice(0, LEADERS_SHOWN).map((row, i) => {
            const li = el("li", row.name === you ? "you" : "");
            li.append(
              el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
              el("span", "who", row.name),
              el("span", "pts", `${row.wins}W ${row.losses}L${row.streak > 0 ? ` · STREAK ${row.streak}` : ""}`),
            );
            return li;
          })),
    );
  }

  function drawBoard(state: BoxState): void {
    const about = state.games.find((g) => g.id === state.focus && g.kind === "team") ?? state.games.find((g) => g.id === DEFAULT_FOCUS);
    gameHead.textContent = about?.title.toUpperCase() ?? "";
    const b: Board | null = state.board;
    if (!b) {
      title.textContent = "READING…";
      titleName.textContent = "";
      cup.textContent = "";
      standings.replaceChildren();
      leaders.replaceChildren();
      return;
    }
    drawLeaders(b.leaders, state.lobby.card?.name ?? null);
    title.textContent = b.title ? `${shortName(b.title.holder)}${b.title.streak > 1 ? ` ×${b.title.streak}` : ""}` : "UP FOR GRABS";
    title.classList.toggle("none", !b.title);
    titleName.textContent = b.title ? `${b.title.name} → ${b.title.holder}` : "win a match to take it";
    const c = b.cup;
    const left = c ? c.ends - link.now() : 0;
    if (!c || left <= 0) {
      cup.textContent = c ? `${cupLabel(c.name)} HAS ENDED · THE WINNER IS PAID AT THE CLOSE` : "NONE OPEN";
      cup.classList.add("none");
      standings.replaceChildren();
      return;
    }
    cup.classList.remove("none");
    cup.textContent = `${cupLabel(c.name)}${c.prize > 0 ? ` · ${usdc(c.prize)} PRIZE` : ""} · ${clock(left)} LEFT`;
    standings.replaceChildren(
      ...(c.standings.length === 0
        ? [el("li", "empty", "no results yet · win 3, draw 1")]
        : c.standings.map((row, i) => {
            const li = el("li");
            li.append(
              el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
              el("span", "who", row.name),
              el("span", "pts", `${row.points} PTS · ${row.wins}-${row.draws}-${row.losses}`),
            );
            return li;
          })),
    );
  }

  function draw(state: BoxState): void {
    drawCard(state.lobby, state);
    drawBoard(state);
  }

  // The championship's countdown runs between the Box's events.
  const ticker = setInterval(() => drawBoard(link.state()), 1000);

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
