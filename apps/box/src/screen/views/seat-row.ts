// The seat panels on a page: one for each seat the page shows, placed by how many there are. Join shows every seat on
// show; the pages after it show the players, so a seat left empty leaves no panel behind.
import type { BoxState, Seat } from "../../core/types.ts";
import { playerSeats } from "../../core/seats.ts";
import type { Layout } from "../shell/layout.ts";
import { place } from "../shell/dom.ts";
import { pageLayout } from "./page-layout.ts";
import { createSeatPanel, type SeatPanel } from "./seat-panel.ts";

export interface SeatRow {
  /** Puts up a panel for each of `seats`, in seat order, and takes down the rest. */
  show(seats: readonly Seat[]): void;
  /** The seat's panel, while it shows. */
  panel(seat: number): SeatPanel | undefined;
}

/** Every seat on show: Join's. */
export function seatsOnShow(state: Pick<BoxState, "seats">): Seat[] {
  return state.seats.map((_, seat) => seat as Seat);
}

/** The players of the match on show, or every seat before there are two. */
export function seatsInPlay(state: Pick<BoxState, "seats">): Seat[] {
  const players = playerSeats(state.seats);
  return players.length >= 2 ? players : seatsOnShow(state);
}

export function createSeatRow(root: HTMLElement, layout: Layout): SeatRow {
  const panels = new Map<number, SeatPanel>();
  let shown = "";

  return {
    show(seats) {
      const key = seats.join();
      if (key === shown) return;
      shown = key;
      for (const [seat, panel] of panels) {
        if (seats.some((s) => s === seat)) continue;
        panel.el.remove();
        panels.delete(seat);
      }
      const rects = pageLayout(layout, seats).seats;
      seats.forEach((seat, i) => {
        const panel = panels.get(seat) ?? createSeatPanel(seat);
        panels.set(seat, panel);
        const rect = rects[i];
        if (rect) place(panel.el, rect);
        panel.el.toggleAttribute("small", seats.length > 2);
        // The plate and the keys stay over the panels, as they did when a page built its two first.
        root.prepend(panel.el);
      });
    },
    panel: (seat) => panels.get(seat),
  };
}
