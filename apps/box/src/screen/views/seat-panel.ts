// A seat's panel on a page: a chamfered frame in the seat's colour round a socket of two rings in a dial of ticks, holding the badge's
// LED blockie, the badge's name, its stats (wins, losses and draws in the focused game, and its USDC, read from chain,
// popping in when the badge taps) and one status line ("TAP YOUR BADGE", "SIGNED", "WINNER"). Lit when the story is
// about this seat (it is asked to act, or it won); a loss dims it. Touching it taps that seat (Demo mode).
import type { Seat, SeatState } from "../../core/types.ts";
import { blockieLedSvg } from "../parts/blockie.ts";
import { chamferClip, fitFrame } from "../parts/frame.ts";
import { motion } from "../parts/part.ts";
import { el } from "../shell/dom.ts";

/** idle, ask (act now), done, win, lose (dimmed), alert (something stops this seat: `NEEDS n USDC`). */
export type SeatTone = "idle" | "ask" | "done" | "win" | "lose" | "alert";

export interface SeatPanel {
  readonly el: HTMLElement;
  set(seat: SeatState, status: string, tone?: SeatTone): void;
  /** A tap landed on this seat. */
  pulse(): void;
}

const CHAMFER = 12;

export function createSeatPanel(seat: Seat): SeatPanel {
  const root = el("div", `seat-panel seat-${seat}`);
  root.dataset.seat = String(seat);
  const outer = el("div", "seat-panel-outer");
  const label = el("div", "seat-panel-label", `PLAYER ${seat + 1}`);
  const socket = el("div", "seat-panel-socket");
  const flash = el("i", "seat-panel-flash");
  const tile = el("div", "seat-panel-tile");
  socket.append(el("i", "seat-panel-dial"), flash, tile);
  const name = el("div", "seat-panel-name");
  const stats = el("div", "seat-panel-stats");
  const status = el("div", "seat-panel-status");
  const words = el("span", "seat-panel-words");
  const glow = el("span", "seat-panel-glow");
  glow.setAttribute("aria-hidden", "true");
  status.append(words, glow);
  const fill = el("i", "frame-fill");
  fill.style.clipPath = chamferClip(CHAMFER);
  root.append(fill, outer, label, socket, name, stats, status);
  fitFrame(root, { chamfer: CHAMFER });
  fitFrame(outer, { chamfer: CHAMFER + 3 });
  let address = "";
  let shown = "";

  return {
    el: root,
    set(s, text, tone = "idle") {
      root.dataset.tone = tone;
      root.toggleAttribute("seated", Boolean(s.badge));
      if ((s.badge?.address ?? "") !== address) {
        address = s.badge?.address ?? "";
        tile.innerHTML = s.badge ? blockieLedSvg(s.badge.address, 72) : "";
      }
      // The player name on chain once it is read, else the badge's local label.
      name.textContent = s.badge ? (s.ens ?? s.badge.name).replace(/\.gamebox\.eth$/, "") : "EMPTY";
      words.textContent = text;
      glow.textContent = text;
      const next = s.badge ? statsKey(s) : "";
      if (next !== shown) {
        const appeared = shown === "" && next !== "";
        shown = next;
        drawStats(stats, s);
        if (appeared) motion(stats, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
      }
    },
    pulse() {
      motion(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
    },
  };
}

const statsKey = (s: SeatState): string =>
  s.record === null && s.balance === null ? "" : `${s.record?.wins}/${s.record?.losses}/${s.record?.draws}/${s.balance}`;

/** `4W 1L 0D · 90 USDC`: the record once it is read (none for a game not on chain), then the balance. */
function drawStats(root: HTMLElement, s: SeatState): void {
  const parts: HTMLElement[] = [];
  if (s.badge && s.record) {
    const { wins, losses, draws } = s.record;
    parts.push(el("span", "seat-stat win", `${wins}W`), el("span", "seat-stat", `${losses}L`), el("span", "seat-stat", `${draws}D`));
  }
  if (s.badge && s.balance !== null) parts.push(el("span", "seat-stat usdc", `${s.balance} USDC`));
  root.replaceChildren(...parts);
}
