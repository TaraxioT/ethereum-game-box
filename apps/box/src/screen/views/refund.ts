// Refund: the Box missed its settle, so the pot's safety net opens. The pot unlocks a while after it opened (an hour on
// Sepolia); then any player's tap, or REFUND ALL, sends one refund that pays every stake back to its badge.
// Refunded, the Box goes Home. HOME leaves sooner: the Box refunds the pot itself once it unlocks. A store match
// comes here when the verifier never paid its pot, and says so.
import type { BoxState } from "../../core/types.ts";
import type { View, ViewContext } from "./view.ts";
import type { EgbKey } from "../parts/key.ts";
import type { EgbPanel } from "../parts/panel.ts";
import { el, place } from "../shell/dom.ts";
import { playerSeats } from "../../core/seats.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatRow, seatsInPlay } from "./seat-row.ts";

/** `mm:ss`, or `h:mm:ss` from an hour up. */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const [h, m, sec] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

export function refundView(ctx: ViewContext): View {
  const { layout, link, sound } = ctx;
  const page = pageLayout(layout, seatsInPlay(link.state()));
  const root = el("div", "page refund");
  const row = createSeatRow(root, layout);

  const plate = document.createElement("egb-panel") as EgbPanel;
  plate.classList.add("page-plate", "refund-plate");
  place(plate, page.plate);
  const head = el("div", "refund-head", "SETTLE MISSED");
  const line = el("div", "refund-line");
  plate.append(head, line);

  const keys = el("div", "page-keys refund-keys");
  place(keys, page.keys);
  const note = el("div", "page-note", "THE BOX WENT OFFLINE BEFORE IT SETTLED. THE POT ON SEPOLIA HOLDS BOTH STAKES.");
  const both = document.createElement("egb-key") as EgbKey;
  both.setAttribute("variant", "alert");
  both.textContent = "REFUND ALL";
  both.addEventListener("click", () => {
    sound.play("ui-select");
    link.send({ type: "refund" });
  });
  const home = document.createElement("egb-key") as EgbKey;
  home.setAttribute("variant", "ghost");
  home.textContent = "HOME";
  home.addEventListener("click", () => {
    sound.play("ui-back");
    link.send({ type: "home" });
  });
  keys.append(note, home, both);
  root.append(plate, keys);

  function draw(state: BoxState): void {
    const m = state.match;
    if (!m) return;
    row.show(seatsInPlay(state));
    const stakes = playerSeats(state.seats).length > 2 ? "EVERY STAKE" : "BOTH STAKES";
    note.textContent = `${m.play.game === "store" ? "THE VERIFIER NEVER PAID THIS MATCH" : "THE BOX WENT OFFLINE BEFORE IT SETTLED"}. THE POT ON SEPOLIA HOLDS ${stakes}.`;
    if (m.play.game === "store") head.textContent = "NOT JUDGED";
    const left = Math.max(0, m.refundAt - link.now());
    if (left > 0) line.replaceChildren("UNLOCKS IN ", el("span", "refund-count", clock(left)));
    else line.textContent = "UNLOCKED · TAP YOUR BADGE";
    const sending = state.txs.some((tx) => tx.kind === "refund" && tx.step !== "paid" && tx.step !== "failed");
    const owed = !m.refunded.every(Boolean) && !sending;
    both.toggleAttribute("disabled", left > 0 || !owed);
    state.seats.forEach((s, i) => {
      const panel = row.panel(i);
      if (m.refunded.every(Boolean)) panel?.set(s, m.stake > 0 ? `REFUNDED · +${m.stake} USDC` : "REFUNDED", "done");
      else if (sending) panel?.set(s, "REFUNDING…", "done");
      else if (left > 0) panel?.set(s, `LOCKED · ${clock(left)}`, "idle");
      else panel?.set(s, "TAP TO REFUND", "ask");
    });
  }

  // The countdown runs on the Box's clock between its events.
  const ticker = setInterval(() => draw(link.state()), 1000);

  return {
    el: root,
    update(state, event) {
      if (event.type === "tap" && event.accepted) row.panel(event.seat)?.pulse();
      draw(state);
    },
    dispose() {
      clearInterval(ticker);
    },
  };
}
