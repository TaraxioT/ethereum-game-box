// Refund: the Box missed its settle, so the escrow's safety net opens. The match waits out its timeout in blocks;
// then each player taps to take their own stake back (a transaction each), or REFUND ALL sends whatever is still
// owed: a refund always pays the stake's owner, whoever asks. Both refunded, the Box goes Home.
import type { BoxState } from "../link/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPlate } from "../parts/plate.ts";
import { el, place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel } from "./seat-panel.ts";

export function refundView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
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

  const keys = el("div", "page-keys refund-keys");
  place(keys, page.keys);
  const note = el("div", "page-note", "THE BOX WENT OFFLINE BEFORE IT SETTLED. THE GAME CONTRACT HOLDS BOTH STAKES.");
  const both = document.createElement("egb-key") as EgbKey;
  both.textContent = "REFUND ALL";
  both.addEventListener("click", () => {
    sound.play("tap");
    link.send({ type: "refund" });
  });
  keys.append(note, both);
  root.append(plate, keys);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m) return;
    const left = Math.max(0, m.refundBlock - state.chain.block);
    line.textContent = left > 0 ? `UNLOCKS AT BLOCK ${m.refundBlock.toLocaleString("en-US")}` : "UNLOCKED · TAP YOUR BADGE";
    const owed = m.refunded.some((done, i) => !done && !state.txs.some((tx) => tx.kind === "refund" && tx.seat === i));
    both.toggleAttribute("disabled", left > 0 || !owed);
    state.seats.forEach((s, i) => {
      const sending = state.txs.some((tx) => tx.kind === "refund" && tx.seat === i && tx.step !== "paid");
      if (m.refunded[i]) panels[i]?.set(s, `REFUNDED · +${m.stake} EGB`, "done");
      else if (sending) panels[i]?.set(s, "REFUNDING…", "done");
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
