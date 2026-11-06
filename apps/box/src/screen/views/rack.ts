// The cartridge rack: one program per game, standing on the Grid's floor along the bottom of the stage. Home focuses
// one; attract shows them idle.
import type { GameId, GameInfo } from "../link/types.ts";
import type { Layout } from "../shell/layout.ts";
import type { EgbCart } from "../parts/cart.ts";
import { el, place } from "../shell/dom.ts";
import { rez } from "../shell/rez.ts";

export interface Rack {
  readonly el: HTMLElement;
  focus(game: GameId | null): void;
  /** The launch: the focused cartridge seats down. */
  press(game: GameId): void;
  /** Attract: after `delay` ms the cartridges rez in, left to right, 90 ms apart. */
  rez(delay: number): Promise<void>;
}

export function createRack(layout: Layout, games: readonly GameInfo[], onPick?: (game: GameId) => void): Rack {
  const root = el("div", "rack");
  const carts = games.map((game, i) => {
    const cart = document.createElement("egb-cart") as EgbCart;
    cart.setAttribute("game", game.id);
    cart.setAttribute("title", game.title);
    cart.setAttribute("slot", String(i + 1));
    const slot = layout.rack[i];
    if (slot) place(cart, slot);
    if (onPick) cart.addEventListener("click", () => onPick(game.id));
    root.append(cart);
    return cart;
  });

  return {
    el: root,
    focus(game) {
      carts.forEach((cart, i) => cart.toggleAttribute("focused", games[i]?.id === game));
    },
    press(game) {
      carts.forEach((cart, i) => cart.toggleAttribute("pressed", games[i]?.id === game));
    },
    async rez(delay) {
      await Promise.all(carts.map((cart, i) => rez(cart, { delay: delay + i * 90 })));
    },
  };
}
