// Join: each player takes a seat by tapping a badge; each seat's USDC balance is read from chain as it fills (a badge
// short of the stake tops up in the lobby). When every seat is full the Box moves on to Stake by itself, once a store
// game's bundle is here and checked. A store game that can start with fewer has a START key, lit once enough have sat
// down.
import type { BoxState } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { honoursOf } from "../../core/honours.ts";
import { joinWords } from "./join-words.ts";
import { createSeatRow, seatsOnShow } from "./seat-row.ts";

export function joinView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout, seatsOnShow(link.state()));
  const root = el("div", "page join");
  const row = createSeatRow(root, layout);

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate");
  place(plate, page.plate);

  const back = document.createElement("egb-key") as EgbKey;
  back.setAttribute("variant", "ghost");
  back.textContent = "BACK";
  const middle = page.keys.x + page.keys.w / 2;
  const opening = link.state();
  /** Fewer than every seat can start, so someone says when. */
  const start = opening.fewest < opening.seats.length ? (document.createElement("egb-key") as EgbKey) : null;
  place(back, { ...page.keys, x: start ? middle - 230 : middle - 110, w: 220 });
  back.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "back" });
  });
  root.append(plate, back);
  if (start) {
    start.textContent = "START";
    place(start, { ...page.keys, x: middle + 10, w: 220 });
    start.addEventListener("click", () => {
      sound.play("ui-select");
      link.send({ type: "begin" });
    });
    root.append(start);
  }

  function draw(state: BoxState): void {
    const game = state.games.find((g) => g.id === state.focus);
    row.show(seatsOnShow(state));
    state.seats.forEach((s, i) => row.panel(i)?.set(s, s.badge ? "READY" : "TAP YOUR BADGE", s.badge ? "done" : "ask"));
    state.seats.forEach((s, i) => row.panel(i)?.honours(honoursOf(s.ens, state.boards, Date.now())));
    const words = joinWords(state, game?.title ?? "");
    plate.textContent = words.plate;
    start?.toggleAttribute("disabled", !words.ready);
  }

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) row.panel(event.seat)?.pulse();
      draw(state);
    },
  };
}
