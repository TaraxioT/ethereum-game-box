// Judging: a store match is over and its log is with the verifier, whose AI judge reads it and says who gets paid how
// much. The Box waits here for the money to move: a paid split or a refund goes to Result, and a verifier that never
// pays goes to Refund. HOME leaves sooner: a verdict pays the pot with nobody watching.
import type { BoxState } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel } from "./seat-panel.ts";
import { judgingWords } from "./judged.ts";

export function judgingView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page judging");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate", "stake-plate");
  place(plate, page.plate);
  const kicker = el("span", "stake-kicker", "JUDGED BY AI");
  const head = el("span", "stake-head");
  const detail = el("span", "stake-detail");
  plate.append(kicker, head, detail);

  const home = document.createElement("egb-key") as EgbKey;
  home.setAttribute("variant", "ghost");
  home.textContent = "HOME";
  place(home, { ...page.keys, x: page.keys.x + page.keys.w / 2 - 110, w: 220 });
  home.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "home" });
  });
  root.append(plate, home);

  function draw(state: BoxState): void {
    const play = state.match?.play;
    const words = judgingWords(play?.game === "store" ? play.judged : null);
    head.textContent = words.head;
    detail.textContent = words.detail;
    state.seats.forEach((s, i) => panels[i]?.set(s, "WAITING FOR THE JUDGE", "idle"));
  }

  return {
    el: root,
    update(state) {
      draw(state);
    },
  };
}
