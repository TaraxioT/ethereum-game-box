// Refund: the Box missed its settle, so the escrow's safety net opens. The match waits out its timeout in blocks;
// then each player taps to take their own stake back (a transaction each). Both refunded, the Box goes Home.
import type { BoxState } from "../link/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbPlate } from "../parts/plate.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel } from "./seat-panel.ts";

export function refundView(ctx: ViewContext): View {
  const { layout } = ctx;
  const page = pageLayout(layout);
  const root = el("div", "page refund");
  const panels = ([0, 1] as const).map((s) => {
    const panel = createSeatPanel(s);
    place(panel.el, page.seats[s]);
    root.append(panel.el);
    return panel;
  });

  const plate = document.createElement("egb-plate") as EgbPlate;
  plate.setAttribute("variant", "metal");
  plate.classList.add("page-plate", "refund-plate");
  place(plate, page.plate);
  const head = el("div", "refund-head", "SETTLE MISSED");
  const line = el("div", "refund-line");
  plate.append(head, line);

  const keysNote = el("div", "page-note", "THE BOX WENT OFFLINE BEFORE IT SETTLED. THE GAME CONTRACT HOLDS BOTH STAKES.");
  place(keysNote, page.keys);
  root.append(plate, keysNote);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m) return;
    const left = Math.max(0, m.refundBlock - state.chain.block);
    line.textContent = left > 0 ? `STAKES UNLOCK AT BLOCK ${m.refundBlock.toLocaleString("en-US")} · ${left} TO GO` : "UNLOCKED · TAP YOUR BADGE";
    state.seats.forEach((s, i) => {
      if (m.refunded[i]) panels[i]?.set(s, `REFUNDED · +${m.stake} EGB`, "done");
      else if (left > 0) panels[i]?.set(s, `LOCKED · ${left} BLOCK${left === 1 ? "" : "S"}`, "idle");
      else panels[i]?.set(s, "TAP TO REFUND", "ask");
    });
  }

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) panels[event.seat]?.pulse();
      draw(state);
    },
  };
}
