// The lobby: a badge tapped on any station shows its card, read from chain: its player name, or (with none yet) a
// name field holding the proposed label, which the player may type over (a tap on the field opens the Box's own
// keyboard, `name-keys.ts`; a keyboard works too; the label rule is checked as they type), with ANOTHER and CLAIM
// (Enter claims too). The Box vouches for the badge with its
// own key: a badge can't sign a claim;
// every title it holds and cup it leads, each by its own ENS name, on one big scrolling line; its stats over every game,
// from its name's `stats` record (the win streak, wins, losses, played, the best streak and its place on the
// leaderboard); its USDC and TOP UP 100 USDC. Beside it, the game's title (`champion.<game>.gamebox.eth`, its holder
// and streak), its open cup (the standings, the prize and a countdown to the close) and the leaderboard over every game
// (`gamebox.eth`'s `leaderboard` record), read through the Universal Resolver every few seconds while the lobby shows.
// Both panels lay their lines out inside their frames: names scroll, and the leaderboard shows the rows that fit. A
// list is redrawn only when it changes, so its names keep scrolling. The transaction bar follows each claim and
// top-up. BACK returns Home, or to Stake when a short balance sent the player here.
import type { Board, BoxState, Leader, Lobby, PlayerRecord, Tx } from "../../core/types.ts";
import { DEFAULT_FOCUS } from "../../core/catalogue.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { labelProblem } from "@egb/shared/names";
import { createNameKeys } from "./name-keys.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { clock } from "./refund.ts";
import { cupLabel } from "./play-for.ts";
import { ensName, setEns } from "../shell/ens-name.ts";
import { honoursOf } from "../../core/honours.ts";
import { honourWords } from "./seat-panel.ts";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];
/** Where the name keyboard opens: right of the card, over the core, the board and the keys. */
const NAME_KEYS = { x: 430, y: 300, w: 790, h: 420 };
/** The panels' padding, as in views.css: their bodies fill the rest. */
const PAD = { x: 22, y: 16 };
/** Leaderboard rows the board draws (it shows the ones that fit), and cup standings. */
const LEADERS_SHOWN = 5;
const STANDINGS_SHOWN = 3;

const usdc = (amount: number): string => `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;

export function lobbyView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page lobby");

  /** A panel whose body is a column exactly its inside's size, so nothing in it can spill past its frame. */
  const panel = (className: string, rect: (typeof page.seats)[0]): { readonly frame: EgbPanel; readonly body: HTMLElement } => {
    const frame = document.createElement("egb-panel") as EgbPanel;
    frame.classList.add(className);
    place(frame, rect);
    const body = el("div", "lobby-body");
    body.style.height = `${rect.h - 2 * PAD.y}px`;
    frame.append(body);
    return { frame, body };
  };

  const { frame: card, body: cardBody } = panel("lobby-card", page.seats[0]);
  const top = el("div", "lobby-top");
  const balance = el("div", "lobby-balance");
  top.append(el("div", "lobby-kicker", "PLAYER"), balance);
  const name = ensName("—", "lobby-name", { split: true });
  // The name to claim, typed over the proposal. Keys typed here are the field's alone.
  const field = document.createElement("input");
  Object.assign(field, { type: "text", className: "lobby-input", maxLength: 32, autocomplete: "off", spellcheck: false, placeholder: "your-name" });
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("enterkeyhint", "done");
  field.setAttribute("aria-label", "the name to claim");
  // The Box draws its own keyboard: the system's opens under the full-screen kiosk.
  field.setAttribute("inputmode", "none");
  const proposal = el("label", "lobby-claim");
  proposal.append(field, el("span", "lobby-suffix", ".gamebox.eth"));
  const fieldHint = el("div", "lobby-hint");
  // What this player holds: each title and cup by its own ENS name, every one resolving to theirs.
  const heldHead = el("div", "lobby-kicker", "HOLDS ON ENS · EACH RESOLVES TO YOU");
  const held = ensName("", "lobby-held");
  const statsHead = el("div", "lobby-kicker", "STATS");
  const stats = el("div", "lobby-stats");
  const statsNote = ensName("", "lobby-note");
  cardBody.append(top, name, proposal, fieldHint, heldHead, held, statsHead, stats, statsNote);

  const { frame: board, body: boardBody } = panel("lobby-board", page.seats[1]);
  const gameHead = el("div", "lobby-game");
  const title = ensName("", "lobby-holder", { split: true });
  const titleName = ensName("", "lobby-map");
  const cupRow = el("div", "lobby-cup");
  const cupName = ensName("", "lobby-cup-name");
  const cupLeft = el("span", "lobby-cup-left");
  cupRow.append(cupName, cupLeft);
  const standings = el("ol", "lobby-standings");
  const leaders = el("ol", "lobby-standings lobby-leaders");
  boardBody.append(
    gameHead,
    el("div", "lobby-kicker", "TITLE"),
    title,
    titleName,
    el("div", "lobby-kicker", "CUP"),
    cupRow,
    standings,
    el("div", "lobby-kicker", "LEADERBOARD · GAMEBOX.ETH"),
    leaders,
  );

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const keys = el("div", "page-keys lobby-keys");
  place(keys, page.keys);
  const key = (text: string, command: "back" | "propose" | "claim" | "buy" | "topup", variant?: string): EgbKey => {
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
  const buy = key("BUY GBX", "buy", "ghost");
  const topup = key("TOP UP 100 USDC", "topup");
  keys.append(back, another, claim, buy, topup);
  root.append(card, board, plate, keys);

  /** Puts `text` in place of the field's selection (or at its caret), then reads the field as typed. */
  const edit = (text: string, back = false): void => {
    let start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    if (back && start === end) start = Math.max(0, start - 1);
    field.setRangeText(text, start, end, "end");
    field.dispatchEvent(new Event("input"));
  };
  const nameKeys = createNameKeys({
    type: (ch) => edit(ch),
    erase: () => edit("", true),
    claim: () => {
      if (claim.hasAttribute("disabled")) return;
      field.blur();
      claim.click();
    },
    done: () => field.blur(),
  });
  place(nameKeys.el, { ...NAME_KEYS, x: NAME_KEYS.x + page.dx });
  root.append(nameKeys.el);
  field.addEventListener("focus", () => nameKeys.open());
  field.addEventListener("blur", () => nameKeys.close());

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
    const pending = (kind: Tx["kind"]): boolean => state.txs.some((tx) => tx.kind === kind && tx.step !== "paid" && tx.step !== "failed");
    const claiming = pending("claim");
    const topping = pending("topup");
    const buying = pending("buy");
    const c = lobby.card;
    card.toggleAttribute("lit", lobby.badge !== null);
    const naming = Boolean(lobby.badge && c && !c.name);
    if (!lobby.badge) {
      setEns(name, "TAP A BADGE");
      name.classList.add("none");
      balance.textContent = "";
    } else {
      setEns(name, c === null ? "reading…" : (c.name ?? "NO NAME YET"));
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
    if (!naming && document.activeElement === field) field.blur();
    const problem = labelProblem(field.value);
    fieldHint.textContent = problem ? `a name needs ${problem}` : "type a name, or keep this one · ENTER OR CLAIM";
    fieldHint.classList.toggle("bad", problem !== null && field.value !== "");
    const honours = honoursOf(c?.name ?? null, state.boards, link.now());
    heldHead.hidden = honours.length === 0;
    held.hidden = honours.length === 0;
    setEns(held, honours.map(honourWords).join("   "));
    drawStats(c?.name ?? null, c?.record ?? null, state.board?.leaders ?? []);
    another.toggleAttribute("disabled", !naming || claiming);
    claim.toggleAttribute("disabled", !naming || claiming || problem !== null);
    nameKeys.claimable(naming && !claiming && problem === null);
    topup.toggleAttribute("disabled", !lobby.badge || topping);
    buy.hidden = !state.buys;
    buy.toggleAttribute("disabled", !lobby.badge || buying);
    plate.textContent = !lobby.badge
      ? `TAP YOUR BADGE ON ${state.stations.length > 2 ? "ANY" : "EITHER"} STATION`
      : claiming
        ? "CLAIMING YOUR NAME ON SEPOLIA…"
        : topping
          ? "TOPPING UP 100 USDC…"
          : buying
            ? "BUYING GBX AT THE TAP FEE…"
            : lobby.from === "stake"
              ? `YOUR STAKE IS ${usdc(state.stake)}: TOP UP, THEN BACK`
              : "TAP ANOTHER BADGE TO SEE IT";
  }

  /** The player's stats from its name's `stats` record, and its place on the leaderboard. */
  function drawStats(ens: string | null, r: PlayerRecord | null, top: readonly Leader[]): void {
    statsHead.hidden = ens === null;
    if (!ens) {
      stats.replaceChildren();
      setEns(statsNote, "");
      return;
    }
    if (!r) {
      stats.replaceChildren(el("div", "lobby-stat none", "NO RESULTS YET"));
      setEns(statsNote, `play a match: it writes ${ens}'s stats record`);
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
    setEns(statsNote, `${ens} · stats record${r.draws > 0 ? ` · ${r.draws} draw${r.draws > 1 ? "s" : ""}` : ""}`);
  }

  /** What each list was last drawn from: a list is redrawn only when it changes, so its names keep scrolling. */
  const drawn = { leaders: "", standings: "" };

  function drawLeaders(top: readonly Leader[], you: string | null): void {
    const key = JSON.stringify([top.slice(0, LEADERS_SHOWN), you]);
    if (key === drawn.leaders) return;
    drawn.leaders = key;
    leaders.replaceChildren(
      ...(top.length === 0
        ? [el("li", "empty", "no results yet · every match counts")]
        : top.slice(0, LEADERS_SHOWN).map((row, i) => {
            const li = el("li", row.name === you ? "you" : "");
            li.append(
              el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
              ensName(row.name, "who"),
              el("span", "pts", `${row.wins}W ${row.losses}L${row.streak > 0 ? ` ×${row.streak}` : ""}`),
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
      setEns(title, "READING…");
      setEns(titleName, "");
      setEns(cupName, "");
      cupLeft.textContent = "";
      drawStandings(null);
      drawLeaders([], null);
      return;
    }
    drawLeaders(b.leaders, state.lobby.card?.name ?? null);
    setEns(title, b.title ? `${b.title.holder}${b.title.streak > 1 ? ` ×${b.title.streak}` : ""}` : "UP FOR GRABS");
    title.classList.toggle("none", !b.title);
    setEns(titleName, b.title ? `${b.title.name} → ${b.title.holder}` : "win one to take it");
    const c = b.cup;
    const left = c ? c.ends - link.now() : 0;
    const open = c !== null && left > 0;
    cupRow.classList.toggle("none", !open);
    setEns(cupName, !c ? "NONE OPEN" : open ? `${c.name}${c.prize > 0 ? ` · ${usdc(c.prize)} PRIZE` : ""}` : `${cupLabel(c.name)} HAS ENDED · THE WINNER IS PAID AT THE CLOSE`);
    cupLeft.textContent = open ? `${clock(left)} LEFT` : "";
    drawStandings(open ? c : null);
  }

  function drawStandings(c: Board["cup"]): void {
    const key = JSON.stringify(c?.standings ?? null);
    if (key === drawn.standings) return;
    drawn.standings = key;
    standings.replaceChildren(
      ...(!c
        ? []
        : c.standings.length === 0
          ? [el("li", "empty", "no results yet · win 3, draw 1")]
          : c.standings.slice(0, STANDINGS_SHOWN).map((row, i) => {
              const li = el("li");
              li.append(
                el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
                ensName(row.name, "who"),
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
