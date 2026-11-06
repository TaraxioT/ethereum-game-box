// The lobby: a badge tapped on either station shows its card, read from chain: its player name, or (with none yet) a
// proposed name with ANOTHER and CLAIM (the Box vouches for the badge with its own key: a badge can't sign a claim);
// its USDC and TOP UP 100 USDC. Beside it, the game's title (`champion.<game>.gamebox.eth`, its holder and streak)
// and its open championship (the standings, the prize and a countdown to the close), read through the Universal
// Resolver. The transaction bar follows each claim and top-up. BACK returns Home, or to Stake when a short balance
// sent the player here.
import type { Board, BoxState, Lobby } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { clock } from "./refund.ts";

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th"];

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
  const proposal = el("div", "lobby-proposal");
  const balance = el("div", "lobby-balance");
  card.append(kicker, name, proposal, balance);

  const board = document.createElement("egb-panel") as EgbPanel;
  board.classList.add("lobby-board");
  place(board, page.seats[1]);
  const titleHead = el("div", "lobby-kicker", "TITLE");
  const title = el("div", "lobby-title");
  const cupHead = el("div", "lobby-kicker", "CHAMPIONSHIP");
  const cup = el("div", "lobby-cup");
  const standings = el("ol", "lobby-standings");
  board.append(titleHead, title, cupHead, cup, standings);

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
      sound.play("tap");
      link.send({ type: command });
    });
    return k;
  };
  const back = key("BACK", "back", "ghost");
  const another = key("ANOTHER", "propose", "ghost");
  const claim = key("CLAIM", "claim");
  const topup = key("TOP UP 100 USDC", "topup");
  keys.append(back, another, claim, topup);
  root.append(card, board, plate, keys);

  function drawCard(lobby: Lobby, state: BoxState): void {
    const claiming = state.txs.some((tx) => tx.kind === "claim" && tx.step !== "paid" && tx.step !== "failed");
    const topping = state.txs.some((tx) => tx.kind === "topup" && tx.step !== "paid" && tx.step !== "failed");
    const c = lobby.card;
    card.toggleAttribute("lit", lobby.badge !== null);
    if (!lobby.badge) {
      name.textContent = "—";
      proposal.textContent = "";
      balance.textContent = "";
    } else {
      name.textContent = c === null ? "reading…" : (c.name ?? "NO NAME YET");
      name.classList.toggle("none", c !== null && c.name === null);
      proposal.textContent = c && !c.name && lobby.proposal ? `claim ${lobby.proposal}.gamebox.eth?` : "";
      balance.textContent = c ? usdc(c.balance) : "… USDC";
    }
    const canClaim = Boolean(c && !c.name && lobby.proposal) && !claiming;
    another.toggleAttribute("disabled", !canClaim);
    claim.toggleAttribute("disabled", !canClaim);
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

  function drawBoard(b: Board | null): void {
    if (!b) {
      title.textContent = "reading…";
      cup.textContent = "reading…";
      standings.replaceChildren();
      return;
    }
    title.replaceChildren(
      ...(b.title
        ? [el("span", "lobby-ens", b.title.name), el("span", "", ` held by ${b.title.holder} · streak ${b.title.streak}`)]
        : [el("span", "", "nobody holds the title yet")]),
    );
    const c = b.cup;
    if (!c) {
      cup.textContent = "no championship open";
      standings.replaceChildren();
      return;
    }
    const left = c.ends - link.now();
    cup.replaceChildren(
      el("span", "lobby-ens", c.name),
      el("span", "", ` · ${usdc(c.prize)} prize · ${left > 0 ? `closes in ${clock(left)}` : "closed for scoring"}`),
    );
    standings.replaceChildren(
      ...(c.standings.length === 0
        ? [el("li", "empty", "no results yet")]
        : c.standings.map((row, i) => {
            const li = el("li");
            li.append(
              el("span", "rank", ORDINAL[i] ?? `${i + 1}th`),
              el("span", "who", row.name),
              el("span", "pts", `${row.points} pts ${row.wins}-${row.draws}-${row.losses}`),
            );
            return li;
          })),
    );
  }

  function draw(state: BoxState): void {
    drawCard(state.lobby, state);
    drawBoard(state.lobby.board);
  }

  // The championship's countdown runs between the Box's events.
  const ticker = setInterval(() => drawBoard(link.state().lobby.board), 1000);

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
