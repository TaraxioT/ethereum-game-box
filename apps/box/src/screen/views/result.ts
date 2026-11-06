// Result: the winner's side lit and paid, the winner named by their player name. The result goes to Sepolia (it pays
// the pot, moves the title and scores the championship); once its receipt is in, what it did is read back from chain
// and listed under the banner ("+20 USDC", "now holds champion.stockduel.gamebox.eth", "mumbai-cup: 2nd, 6 pts"),
// never made up here. A draw sends both stakes back, and so does a void (a built game's rules failed); a free-play
// game shows no money. Rematch goes back to Stake with the same seats; Home returns to the library.
import type { BoxState, SeatState } from "../../core/types.ts";
import { badgeLabel } from "../../core/badges.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import { rez } from "../shell/rez.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { createSeatPanel } from "./seat-panel.ts";

/** A seat's player name on chain, else its badge's label. */
function nameOf(seat: SeatState | undefined): string | null {
  if (!seat?.badge) return null;
  return seat.ens ?? badgeLabel(seat.badge);
}

export function resultView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page result");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const banner = document.createElement("egb-panel") as EgbPanel;
  banner.classList.add("page-plate", "result-banner");
  place(banner, page.plate);
  const bannerText = el("span", "result-banner-text");
  /** The lines read from chain after the result's receipt. */
  const chainLines = el("ul", "result-lines");
  banner.append(bannerText, chainLines);

  const keys = el("div", "page-keys");
  place(keys, page.keys);
  const home = document.createElement("egb-key") as EgbKey;
  home.setAttribute("variant", "ghost");
  home.textContent = "HOME";
  home.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "home" });
  });
  const rematch = document.createElement("egb-key") as EgbKey;
  rematch.textContent = "REMATCH";
  rematch.addEventListener("click", () => {
    sound.play("ui-select");
    link.send({ type: "rematch" });
  });
  keys.append(home, rematch);
  root.append(banner, keys);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m?.outcome) return;
    const { winner } = m.outcome;
    const money = m.stake > 0;
    state.seats.forEach((s, i) => {
      if (m.voided) panels[i]?.set(s, money ? `VOID · ${m.stake} USDC BACK` : "VOID", "done");
      else if (winner === null) panels[i]?.set(s, money ? `DRAW · ${m.stake} USDC BACK` : "DRAW", "done");
      else if (winner === i) panels[i]?.set(s, money ? `WINNER · +${m.stake * 2} USDC${m.playFor === "title" ? " · TITLE" : ""}` : "WINNER", "win");
      else panels[i]?.set(s, money ? `−${m.stake} USDC` : "LOSE", "lose");
      panels[i]?.honours(honoursOf(s.ens, state.boards, link.now()));
    });
    const named = winner === null ? null : nameOf(state.seats[winner]);
    bannerText.textContent = m.voided
      ? "VOID · THE GAME FAILED"
      : winner === null
        ? money ? "DRAW · STAKES RETURNED" : "DRAW"
        : `${named ?? `PLAYER ${winner + 1}`} WINS`;
    const onChain = money || m.playFor !== "usdc";
    const lines = m.lines ?? (onChain && !m.voided ? ["reading the result from Sepolia…"] : []);
    chainLines.replaceChildren(...lines.map((text) => el("li", m.lines ? "" : "pending", text)));
    bannerText.className = `result-banner-text ${winner === null ? "draw" : `seat-${winner}`}`;
    fitFont(bannerText, page.plate.w - 72, 40);
  }

  return {
    el: root,
    update(state, event) {
      draw(state);
      if (event.type === "init") void rez(banner, { delay: 380 });
    },
  };
}
