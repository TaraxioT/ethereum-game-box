// The cartridge rack: one keycap cartridge per game, standing in its housing along the bottom of the board. Home
// focuses one; attract shows them idle.
import type { GameId, GameInfo } from "../../core/types.ts";
import type { Layout } from "../shell/layout.ts";
import type { EgbCart } from "../parts/cart.ts";
import { el, place, play } from "../shell/dom.ts";

export interface Rack {
  readonly el: HTMLElement;
  focus(game: GameId | null): void;
  /** The launch: the focused cartridge seats down. */
  press(game: GameId): void;
  /** Boot and attract: the cartridges rise into their housings one after another. */
  rise(): Promise<void>;
}

export function createRack(layout: Layout, games: readonly GameInfo[], onPick?: (game: GameId) => void): Rack {
  const root = el("div", "rack");
  const carts = games.map((game, i) => {
    const cart = document.createElement("egb-cart") as EgbCart;
    cart.setAttribute("game", game.id);
    cart.setAttribute("title", game.title);
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
