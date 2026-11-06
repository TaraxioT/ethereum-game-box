// A seat's panel on a page: a chamfered frame in the seat's colour round a socket of two rings in a dial of ticks, holding the badge's
// LED blockie, the player's ENS name (`nova` bright, `.gamebox.eth` dim; the badge's own label until it is read; a long
// one scrolls), every title it holds and cup it leads on one scrolling line in brass (each by its own ENS name, which
// resolves to the player), its stats (wins, losses and draws over every game, the streak, and its USDC, read from
// chain, popping in when the badge taps) and one status line ("TAP YOUR BADGE", "SIGNED", "WINNER"). Every line stays
// inside the frame: the names scroll, the stats and the status shrink to fit. Lit when the story is about this seat (it
// is asked to act, or it won); a loss dims it. Touching it taps that seat (Demo mode).
import { playerName } from "../../core/badges.ts";
import type { Honour } from "../../core/honours.ts";
import type { Seat, SeatState } from "../../core/types.ts";
import { blockieLedSvg } from "../parts/blockie.ts";
import { chamferClip, fitFrame } from "../parts/frame.ts";
import { motion } from "../parts/part.ts";
import { el } from "../shell/dom.ts";
import { ensName, setEns } from "../shell/ens-name.ts";

/** idle, ask (act now), done, win, lose (dimmed), alert (something stops this seat: `NEEDS n USDC`). */
export type SeatTone = "idle" | "ask" | "done" | "win" | "lose" | "alert";

export interface SeatPanel {
  readonly el: HTMLElement;
  set(seat: SeatState, status: string, tone?: SeatTone): void;
  /** The titles the seated player holds and the championships they lead (the first shows). */
  honours(list: readonly Honour[]): void;
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
  const name = ensName("EMPTY", "seat-panel-name", { split: true });
  const honour = ensName("", "seat-panel-honour");
  const stats = el("div", "seat-panel-stats");
  const status = el("div", "seat-panel-status");
  const words = el("span", "seat-panel-words");
  const glow = el("span", "seat-panel-glow");
  glow.setAttribute("aria-hidden", "true");
  status.append(words, glow);
  const fill = el("i", "frame-fill");
  fill.style.clipPath = chamferClip(CHAMFER);
  root.append(fill, outer, label, socket, name, honour, stats, status);
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
      // The player's ENS name once it is read, else the badge's local label.
      setEns(name, s.badge ? playerName(s.badge, s.ens) : "EMPTY");
      words.textContent = text;
      glow.textContent = text;
      shrink(status, inner(root));
      const next = s.badge ? statsKey(s) : "";
      if (next !== shown) {
        const appeared = shown === "" && next !== "";
        shown = next;
        drawStats(stats, s);
        shrink(stats, inner(root));
        if (appeared) motion(stats, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
      }
    },
    honours(list) {
      honour.dataset.kind = list.length === 0 ? "" : list.every((h) => h.kind === "cup") ? "cup" : "title";
      setEns(honour, list.map(honourWords).join("   "));
    },
    pulse() {
      motion(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 260, easing: "ease-out" });
    },
  };
}

/** `♛ champion.quickdraw.gamebox.eth ×2`, `★ mumbai-cup.quickdraw.gamebox.eth · 3 PTS`. */
export const honourWords = (h: Honour): string =>
  h.kind === "title" ? `♛ ${h.name}${h.count > 1 ? ` ×${h.count}` : ""}` : `★ ${h.name} · ${h.count} PTS`;

/** The width inside a panel's padding. */
const inner = (root: HTMLElement): number => root.clientWidth - 2 * parseFloat(getComputedStyle(root).paddingLeft || "0");

/** A one-line row back at its own size, then shrunk to `width` if it is wider. */
function shrink(row: HTMLElement, width: number): void {
  row.style.fontSize = "";
  if (width <= 0 || row.scrollWidth <= width) return;
  const size = parseFloat(getComputedStyle(row).fontSize);
  row.style.fontSize = `${Math.floor((size * width) / row.scrollWidth)}px`;
}

const statsKey = (s: SeatState): string =>
  s.record === null && s.balance === null ? "" : `${JSON.stringify(s.record)}/${s.balance}`;

/** `4W 1L 0D · STREAK 3 · 90 USDC`: the player's stats over every game from its name's `stats` record, once read (the
 *  streak only while it runs), then the balance. */
function drawStats(root: HTMLElement, s: SeatState): void {
  const parts: HTMLElement[] = [];
  if (s.badge && s.record) {
    const { wins, losses, draws, streak } = s.record;
    parts.push(el("span", "seat-stat win", `${wins}W`), el("span", "seat-stat", `${losses}L`), el("span", "seat-stat", `${draws}D`));
    if (streak > 0) parts.push(el("span", "seat-stat streak", `STREAK ${streak}`));
  }
  if (s.badge && s.balance !== null) parts.push(el("span", "seat-stat usdc", `${s.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`));
  root.replaceChildren(...parts);
}
