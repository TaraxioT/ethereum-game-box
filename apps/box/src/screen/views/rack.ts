// The cartridge rack: one keycap cartridge per entry, standing in its housing along the bottom of the board. Home
// focuses one; attract shows them idle. An entry is a game's cartridge or the blank NEW GAME one that opens the game
// builder (the Box's own screen only); more entries than the layout has housings continue along the row.
import type { GameInfo } from "../../core/types.ts";
import type { Layout, Rect } from "../shell/layout.ts";
import type { EgbCart } from "../parts/cart.ts";
import { el, place, play } from "../shell/dom.ts";

export interface RackCart {
  /** A game's id, or NEW_GAME's. */
  readonly id: string;
  readonly title: string;
  /** What `<egb-cart game>` draws: a game's art, sealed, or the blank cartridge. */
  readonly art: string;
}

/** The blank cartridge at the end of the rack: it opens the game builder. */
export const NEW_GAME: RackCart = { id: "new-game", title: "NEW GAME", art: "new-game" };

export const cartOf = (game: GameInfo): RackCart => ({ id: game.id, title: game.title, art: game.id });

/** The game builder is on the Box's own screen only: the demo's rack has no NEW GAME. */
export const HAS_BUILDER = import.meta.env.VITE_EGB_MODE === "box";

/** The rack for a library: every game in its order, then NEW GAME where the Box has the builder. */
export const rackOf = (games: readonly GameInfo[]): RackCart[] => [...games.map(cartOf), ...(HAS_BUILDER ? [NEW_GAME] : [])];

/** Keeps the row off the stage's edges. */
const MARGIN = 16;

/**
 * Where each of `count` cartridges stands: the layout's housings (each fed by a trace), then on along the row at the
 * same pitch. A row too long for the stage closes up to fit, its housings scaled about their feet.
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
  /** Boot and attract: the cartridges rise into their housings one after another. */
  rise(): Promise<void>;
}

export function createRack(layout: Layout, entries: readonly RackCart[], onPick?: (id: string) => void): Rack {
  const root = el("div", "rack");
  const slots = rackSlots(layout, entries.length);
  const carts = entries.map((entry, i) => {
    const cart = document.createElement("egb-cart") as EgbCart;
    cart.setAttribute("game", entry.art);
    cart.setAttribute("title", entry.title);
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
    async rise() {
      await Promise.all(
        carts.map((cart, i) =>
          play(cart, [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], {
            duration: 420, delay: i * 90, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "backwards",
          }),
        ),
      );
    },
  };
}
