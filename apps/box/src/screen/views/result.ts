// Result: the winner's side lit and paid. The payout runs from the core to the winner's port on the LCD; a draw sends
// both stakes back, and so does a void (a built game's rules failed). Rematch goes back to Stake with the same seats;
// Home returns to the library.
import type { BoxState } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, fitFont, place } from "../shell/dom.ts";
import { rez } from "../shell/rez.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel } from "./seat-panel.ts";

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
  banner.append(bannerText);

  const keys = el("div", "page-keys");
  place(keys, page.keys);
  const home = document.createElement("egb-key") as EgbKey;
  home.setAttribute("variant", "ghost");
  home.textContent = "HOME";
  home.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "home" });
  });
  const rematch = document.createElement("egb-key") as EgbKey;
  rematch.textContent = "REMATCH";
  rematch.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "rematch" });
  });
  keys.append(home, rematch);
  root.append(banner, keys);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m?.outcome) return;
    const { winner } = m.outcome;
    state.seats.forEach((s, i) => {
      if (m.voided) panels[i]?.set(s, `VOID · ${m.stake} EGB BACK`, "done");
      else if (winner === null) panels[i]?.set(s, `DRAW · ${m.stake} EGB BACK`, "done");
      else if (winner === i) panels[i]?.set(s, `WINNER · +${m.stake * 2} EGB`, "win");
      else panels[i]?.set(s, `−${m.stake} EGB`, "lose");
    });
    bannerText.textContent = m.voided ? "VOID · THE GAME FAILED" : winner === null ? "DRAW · STAKES RETURNED" : `PLAYER ${winner + 1} WINS`;
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
