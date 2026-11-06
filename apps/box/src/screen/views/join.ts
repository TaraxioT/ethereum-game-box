// Join: both players take a seat by tapping a badge; each seat's USDC balance is read from chain as it fills (a badge
// short of the stake tops up in the lobby). When both seats are full the Box moves on to Stake by itself.
import type { BoxState, Seat } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { createSeatPanel } from "./seat-panel.ts";

export function joinView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page join");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const back = document.createElement("egb-key") as EgbKey;
  back.setAttribute("variant", "ghost");
  back.textContent = "BACK";
  place(back, { ...page.keys, x: page.keys.x + page.keys.w / 2 - 110, w: 220 });
  back.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "back" });
  });
  root.append(plate, back);

  function draw(state: BoxState): void {
    const game = state.games.find((g) => g.id === state.focus);
    state.seats.forEach((s, i) => panels[i]?.set(s, s.badge ? "READY" : "TAP YOUR BADGE", s.badge ? "done" : "ask"));
    state.seats.forEach((s, i) => panels[i]?.honours(honoursOf(s.ens, state.boards, Date.now())));
    const waiting = state.seats.filter((s) => !s.badge).length;
    plate.textContent = waiting ? `${game?.title ?? ""} · TAP ${waiting === 2 ? "BOTH BADGES" : "A BADGE"} TO JOIN` : "BOTH SEATED";
  }

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) panels[event.seat as Seat]?.pulse();
      draw(state);
    },
  };
}
