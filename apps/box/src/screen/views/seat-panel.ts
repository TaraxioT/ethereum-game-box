// A seat's panel on a page: a bevelled gunmetal module in the seat's colour with a socket, the badge's blockie and
// name, and one status line ("TAP YOUR BADGE", "SIGNED", "WINNER"). Lit when the story is about this seat.
import type { Seat, SeatState } from "../link/types.ts";
import { blockieSvg } from "../parts/blockie.ts";
import { el, play } from "../shell/dom.ts";

export interface SeatPanel {
  readonly el: HTMLElement;
  set(seat: SeatState, status: string, tone?: "idle" | "ask" | "done" | "win" | "lose"): void;
  /** A tap landed on this seat. */
  pulse(): void;
}

export function createSeatPanel(seat: Seat): SeatPanel {
  const root = el("div", `seat-panel seat-${seat}`);
  const label = el("div", "seat-panel-label", `PLAYER ${seat + 1}`);
  const socket = el("div", "seat-panel-socket");
  const tile = el("div", "seat-panel-tile");
  socket.append(tile);
  const name = el("div", "seat-panel-name");
  const status = el("div", "seat-panel-status");
  root.append(label, socket, name, status);
  let address = "";

  return {
    el: root,
    set(s, text, tone = "idle") {
      root.dataset.tone = tone;
      root.toggleAttribute("seated", Boolean(s.badge));
      if ((s.badge?.address ?? "") !== address) {
        address = s.badge?.address ?? "";
        tile.innerHTML = s.badge ? blockieSvg(s.badge.address, 96) : "";
      }
      name.textContent = s.badge ? s.badge.name.replace(/\.gamebox\.eth$/, "") : "EMPTY SEAT";
      status.textContent = text;
    },
    pulse() {
      void play(socket, [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
        duration: 260, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    },
  };
}
