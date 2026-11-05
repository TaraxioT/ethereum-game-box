// The badges lying on the desk: NFC cards with a chip, the badge's blockie and its name. Drag one (mouse or touch)
// onto a puck and it taps there, then slides home; dropped anywhere else it springs back. A seated badge wears a
// seat-colour lamp.
import type { SimControl } from "../link/sim/control.ts";
import type { Badge, BoxState } from "../link/types.ts";
import { blockieSvg } from "../parts/blockie.ts";
import { calm, el } from "../shell/dom.ts";
import type { Puck } from "./puck.ts";

export interface BadgeTray {
  readonly el: HTMLElement;
  update(state: BoxState): void;
  /** The cards' height in CSS px; they lie side by side, overlapping when the tray is narrow. */
  size(cardHeight: number): void;
  dispose(): void;
}

/** An ID card's proportions, width over height. */
export const CARD_RATIO = 1.586;
const CARD_GAP = 14;
/** Movement (px) before a press becomes a drag. */
const SLOP = 4;

interface Card {
  readonly badge: Badge;
  readonly el: HTMLElement;
  readonly lamps: readonly [HTMLElement, HTMLElement];
}

function label(badge: Badge): { readonly head: string; readonly rest: string } {
  const dot = badge.name.indexOf(".");
  return dot < 0 ? { head: badge.name, rest: "" } : { head: badge.name.slice(0, dot), rest: badge.name.slice(dot) };
}

function createCard(badge: Badge): Card {
  const card = el("div", "dk-badge");
  const { head, rest } = label(badge);
  card.setAttribute("role", "img");
  card.setAttribute("aria-label", `Badge ${badge.name}: drag it onto a tap station`);
  const face = el("div", "dk-badge-face");
  const slot = el("span", "dk-badge-slot");
  const tile = el("span", "dk-badge-blockie");
  tile.innerHTML = blockieSvg(badge.address, 48);
  const chip = el("span", "dk-badge-chip");
  const name = el("span", "dk-badge-name", head);
  const ens = el("span", "dk-badge-ens", rest);
  const lamps: [HTMLElement, HTMLElement] = [el("span", "dk-badge-lamp"), el("span", "dk-badge-lamp")];
  lamps.forEach((lamp, seat) => {
    lamp.dataset.seat = String(seat);
    lamp.hidden = true;
  });
  const lampRow = el("span", "dk-badge-lamps");
  lampRow.append(...lamps);
  face.append(slot, tile, chip, name, ens, lampRow);
  card.append(face);
  return { badge, el: card, lamps };
}

export function createBadgeTray(sim: Pick<SimControl, "badges" | "botBadge" | "tap">, pucks: readonly Puck[]): BadgeTray {
  const tray = el("div", "dk-tray");
  const cards = sim.badges.filter((b) => b.address !== sim.botBadge.address).map(createCard);
  tray.append(...cards.map((c) => c.el));
  let cardH = 0;

  function place(): void {
    if (cardH <= 0) return;
    const width = tray.clientWidth;
    const cardW = Math.min(Math.round(cardH * CARD_RATIO), width);
    const n = cards.length;
    const step = n > 1 ? Math.min(cardW + CARD_GAP, (width - cardW) / (n - 1)) : 0;
    const start = (width - (cardW + step * (n - 1))) / 2;
    tray.style.setProperty("--card-w", `${cardW}px`);
    tray.style.setProperty("--card-h", `${Math.round(cardW / CARD_RATIO)}px`);
    cards.forEach((card, i) => {
      card.el.style.left = `${Math.round(start + i * step)}px`;
      card.el.style.zIndex = String(i + 1);
    });
  }

  const observer = new ResizeObserver(place);
  observer.observe(tray);

  const cleanups = cards.map((card) => drag(card, sim, pucks));

  return {
    el: tray,
    update(state) {
      for (const card of cards) {
        card.lamps.forEach((lamp, seat) => {
          lamp.hidden = state.seats[seat]?.badge?.address !== card.badge.address;
        });
      }
    },
    size(height) {
      cardH = height;
      place();
    },
    dispose() {
      observer.disconnect();
      cleanups.forEach((stop) => stop());
    },
  };
}

/** Pointer dragging for one card. Returns its cleanup. */
function drag(card: Card, sim: Pick<SimControl, "tap">, pucks: readonly Puck[]): () => void {
  const node = card.el;
  let pointer: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let lifted = false;
  let over: Puck | null = null;
  let home: ReturnType<typeof setTimeout> | undefined;

  function moveTo(dx: number, dy: number, scale: number, ms: number, easing: string): void {
    node.style.transition = ms > 0 && !calm() ? `transform ${ms}ms ${easing}` : "none";
    node.style.transform = dx || dy || scale !== 1 ? `translate(${dx}px, ${dy}px) scale(${scale})` : "";
  }

  function target(x: number, y: number): Puck | null {
    return pucks.find((p) => p.hits(x, y)) ?? null;
  }

  function settle(): void {
    node.classList.remove("dk-badge-lifted");
    moveTo(0, 0, 1, 420, "var(--ease-spring)");
  }

  const down = (e: PointerEvent): void => {
    if (pointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    clearTimeout(home);
    pointer = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    lifted = false;
    node.setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    const dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (!lifted && Math.hypot(dx, dy) < SLOP) return;
    if (!lifted) {
      lifted = true;
      node.classList.add("dk-badge-lifted");
    }
    moveTo(dx, dy, 1.05, 0, "");
    const next = target(e.clientX, e.clientY);
    if (next !== over) {
      over?.arm(false);
      next?.arm(true);
      over = next;
    }
  };

  const up = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    over?.arm(false);
    const drop = lifted && e.type === "pointerup" ? target(e.clientX, e.clientY) : null;
    over = null;
    if (!drop) return settle();
    // The card lands on the puck's face, the station reads it, and it slides back to its place on the desk.
    const p = drop.el.getBoundingClientRect();
    const c = node.getBoundingClientRect();
    const base = { x: c.left + c.width / 2 - (e.clientX - x0), y: c.top + c.height / 2 - (e.clientY - y0) };
    moveTo(p.left + p.width / 2 - base.x, p.top + p.height / 2 - base.y, 0.9, 140, "var(--ease-out)");
    sim.tap(drop.seat, card.badge);
    home = setTimeout(settle, calm() ? 0 : 300);
  };

  node.addEventListener("pointerdown", down);
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
  return () => {
    clearTimeout(home);
    node.removeEventListener("pointerdown", down);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerup", up);
    node.removeEventListener("pointercancel", up);
  };
}
