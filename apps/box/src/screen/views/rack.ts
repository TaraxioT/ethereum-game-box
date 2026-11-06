// The cartridge rack: one program per entry, standing on the Grid's floor along the bottom of the stage. Home focuses
// one; attract shows them idle. An entry is a game's program, the TITLES & CUPS one that opens the hall, or the blank
// NEW GAME one that opens the game builder (the Box's own screen only); more entries than the layout has slots continue
// along the row.
import type { GameInfo } from "../../core/types.ts";
import type { Layout, Rect } from "../shell/layout.ts";
import type { EgbCart } from "../parts/cart.ts";
import { el, place } from "../shell/dom.ts";
import { rez } from "../shell/rez.ts";

export interface RackCart {
  /** A game's id, or NEW_GAME's. */
  readonly id: string;
  readonly title: string;
  /** What `<egb-cart game>` draws: a game's art, sealed, or the blank cartridge. */
  readonly art: string;
  /** A built game's art, served by the Box. */
  readonly icon: string | null;
  /** A game that should play but can't: its cover says SEALED. */
  readonly sealed: boolean;
}

/** The blank cartridge at the end of the rack: it opens the game builder. */
export const NEW_GAME: RackCart = { id: "new-game", title: "NEW GAME", art: "new-game", icon: null, sealed: false };

/** The hall's cartridge, after the games: every title and cup and the leaderboard, each played for from its card. */
export const HALL: RackCart = { id: "hall", title: "TITLES & CUPS", art: "hall", icon: null, sealed: false };

export const cartOf = (game: GameInfo): RackCart => ({ id: game.id, title: game.title, art: game.id, icon: game.icon, sealed: game.sealed !== null });

/** The game builder is on the Box's own screen only: the demo's rack has no NEW GAME. */
export const HAS_BUILDER = import.meta.env.VITE_EGB_MODE === "box";

/** The rack for a library: every game in its order, the hall, then NEW GAME where the Box has the builder. */
export const rackOf = (games: readonly GameInfo[]): RackCart[] => [...games.map(cartOf), HALL, ...(HAS_BUILDER ? [NEW_GAME] : [])];

/** Keeps the row off the stage's edges. */
const MARGIN = 16;

/**
 * Where each of `count` cartridges stands: the layout's slots (each fed by a trace), then on along the row at the
 * same pitch. A row too long for the stage closes up to fit, its slots scaled about their feet.
 */
export function rackSlots(layout: Layout, count: number): Rect[] {
  const base = layout.rack;
  if (count <= base.length) return base.slice(0, count);
  const first = base[0]!;
  const last = base[base.length - 1]!;
  const pitch = base.length > 1 ? (last.x - first.x) / (base.length - 1) : last.w + 24;
  const slots = [...base];
  for (let i = base.length; i < count; i++) slots.push({ ...last, x: last.x + pitch * (i - base.length + 1) });
  const end = slots[slots.length - 1]!;
  if (end.x + end.w <= layout.width - MARGIN) return slots;
  const span = (count - 1) * pitch + first.w;
  const s = (layout.width - 2 * MARGIN) / span;
  return slots.map((r, i) => ({ x: MARGIN + i * pitch * s, y: r.y + r.h * (1 - s), w: r.w * s, h: r.h * s }));
}

export interface Rack {
  readonly el: HTMLElement;
  focus(id: string | null): void;
  /** The launch: the focused cartridge seats down. */
  press(id: string): void;
  /** Attract: after `delay` ms the cartridges rez in, left to right, 90 ms apart. */
  rez(delay: number): Promise<void>;
  /** A game just installed: its cartridge rezzes in where it stands. */
  arrive(id: string): void;
}

export function createRack(layout: Layout, entries: readonly RackCart[], onPick?: (id: string) => void): Rack {
  const root = el("div", "rack");
  const slots = rackSlots(layout, entries.length);
  const carts = entries.map((entry, i) => {
    const cart = document.createElement("egb-cart") as EgbCart;
    cart.setAttribute("game", entry.art);
    cart.setAttribute("title", entry.title);
    cart.setAttribute("slot", String(i + 1));
    if (entry.icon) cart.setAttribute("icon", entry.icon);
    cart.toggleAttribute("sealed", entry.sealed);
    const slot = slots[i];
    if (slot) place(cart, slot);
    if (onPick) cart.addEventListener("click", () => onPick(entry.id));
    root.append(cart);
    return cart;
  });

  return {
    el: root,
    focus(id) {
      carts.forEach((cart, i) => cart.toggleAttribute("focused", entries[i]?.id === id));
    },
    press(id) {
      carts.forEach((cart, i) => cart.toggleAttribute("pressed", entries[i]?.id === id));
    },
    async rez(delay) {
      await Promise.all(carts.map((cart, i) => rez(cart, { delay: delay + i * 90 })));
    },
    arrive(id) {
      const cart = carts[entries.findIndex((entry) => entry.id === id)];
      if (cart) void rez(cart);
    },
  };
}
