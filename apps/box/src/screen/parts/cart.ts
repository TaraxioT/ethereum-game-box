// <egb-cart game="…">: a game's program in the rack. A chamfered frame (cut top right and bottom left) round an art
// window with a faint inner grid and the game's art drawn in light, and the title under it. A game with no art yet
// (Bet on X, B17) is sealed: the window hatched, the title dim, a small SOON tag; its frame never goes above 50 %.
//
// Size: it fills its box (designed at 176 × 186). Attributes: `game`, `title` (the printed title), `focused` (it
// lifts 12 px on a spring, and only once it has risen its frame lights with its bloom, a hot foot bar shows and the
// title brightens; losing focus it drops back and dims), `pressed` (the launch: the frame flashes white and the
// cartridge settles 6 px).
import { chamferClip, fitFrame } from "./frame.ts";
import { motion, pick, shadow, sheet } from "./part.ts";

const CHAMFER = 16;

/** The art in each built game's window, on a 120 × 64 grid. */
const ART: Record<string, string> = {
  // A lightning bolt in hot outline over a soft bloom, and three sparks off it.
  "quick-draw": `<svg viewBox="0 0 120 64" aria-hidden="true">
    <path class="bloom" d="M68 4 44 34h15l-8 26 27-32H63L75 4Z"/>
    <path class="hot" d="M68 4 44 34h15l-8 26 27-32H63L75 4Z"/>
    <path class="spark" d="M38 16l-7-5M34 26h-8M84 14l7-6"/>
  </svg>`,
  // Four candlesticks in lines, Player 1's orange against Player 2's cyan, each with its wick.
  "stock-duel": `<svg viewBox="0 0 120 64" aria-hidden="true">
    ${(
      [
        [28, 34, 52, 28, 58, "o"],
        [50, 24, 42, 18, 48, "c"],
        [72, 28, 44, 22, 50, "o"],
        [94, 10, 30, 4, 36, "c"],
      ] as const
    )
      .map(
        ([x, top, bottom, wickTop, wickBottom, seat]) =>
          `<g class="${seat}"><path d="M${x} ${wickTop}V${top}M${x} ${bottom}V${wickBottom}"/><rect x="${x - 6}" y="${top}" width="12" height="${bottom - top}"/></g>`,
      )
      .join("")}
  </svg>`,
};

const styles = sheet(`
:host { display: block; position: relative; width: 176px; height: 186px; container-type: size; cursor: pointer; }
.cart {
  --p: calc(100cqw / 176); position: absolute; inset: 0;
  transition: transform 200ms var(--ease-out);
}
.frame-fill { position: absolute; inset: 0; background: var(--void-2); clip-path: ${chamferClip(CHAMFER, "tr-bl")}; }
.flash { position: absolute; inset: 0; background: var(--sys-hot); opacity: 0; clip-path: ${chamferClip(CHAMFER, "tr-bl")}; }
.frame-line { opacity: 0.3; transition: opacity 200ms linear; }
.frame-bloom { opacity: 0; transition: opacity 200ms linear; }

/* The art window: the top 58 %, a faint 16 px grid behind the art. */
.window {
  position: absolute; left: calc(12 * var(--p)); right: calc(12 * var(--p)); top: calc(12 * var(--p)); height: calc(58% - 12 * var(--p));
  background:
    repeating-linear-gradient(0deg, rgb(207 232 246 / 0.06) 0 1px, transparent 1px 16px),
    repeating-linear-gradient(90deg, rgb(207 232 246 / 0.06) 0 1px, transparent 1px 16px);
  box-shadow: inset 0 0 0 1px rgb(207 232 246 / 0.1);
}
.window svg { position: absolute; inset: calc(6 * var(--p)); width: calc(100% - 12 * var(--p)); height: calc(100% - 12 * var(--p)); overflow: visible; }
.bloom { fill: none; stroke: var(--sys); stroke-width: 6; stroke-opacity: 0.18; stroke-linejoin: round; }
.hot { fill: none; stroke: var(--sys-hot); stroke-width: 2; stroke-linejoin: round; }
.spark { fill: none; stroke: var(--sys); stroke-width: 2; stroke-linecap: round; }
.o { stroke: var(--p1); }
.c { stroke: var(--p2); }
.o, .c { fill: none; stroke-width: 2; }
/* Sealed: static diagonal hatching where the art would be. */
.window.sealed { background: repeating-linear-gradient(135deg, rgb(207 232 246 / 0.08) 0 1px, transparent 1px 10px); }

.title {
  position: absolute; left: calc(8 * var(--p)); right: calc(8 * var(--p)); top: 58%; bottom: calc(8 * var(--p));
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(6 * var(--p));
  text-align: center;
}
.name {
  font: 700 max(14px, calc(18 * var(--p))) / 1.15 var(--hud-display); text-transform: uppercase; text-wrap: balance;
  color: var(--fg); opacity: 0.72; transition: opacity 200ms linear;
}
.soon { padding: 3px 8px; border: 1px solid var(--fg-4); font: 600 14px / 1 var(--hud-body); letter-spacing: 0.12em; color: var(--fg-4); }
.cart.sealed .name { color: var(--fg-4); opacity: 1; }
/* The hot foot bar under the frame, shown once the cartridge has risen. */
.foot {
  position: absolute; left: calc(24 * var(--p)); right: calc(24 * var(--p)); bottom: calc(-8 * var(--p)); height: 2px;
  background: var(--sys-hot); box-shadow: 0 0 6px var(--sys-bloom), 0 0 14px var(--sys-bloom); opacity: 0; transition: opacity 200ms linear;
}

/* Focused: it lifts on a spring; only once it is up do its frame, foot and title light. */
:host([focused]) .cart { transform: translateY(calc(-12 * var(--p))); transition: transform var(--t-move) var(--ease-spring); }
:host([focused]) :is(.frame-line, .frame-bloom, .foot, .name) { opacity: 1; transition: opacity 180ms linear 300ms; }
:host([focused]) .cart.sealed .frame-line { opacity: 0.5; }
:host([focused]) .cart.sealed :is(.frame-bloom, .foot) { opacity: 0; }
/* Pressed: it settles 6 px from where it stood. */
:host([pressed]) .cart { transform: translateY(calc(-6 * var(--p))); transition: transform 140ms var(--ease-in); }
`);

export class EgbCart extends HTMLElement {
  static readonly observedAttributes = ["game", "title", "pressed"];
  readonly #cart: HTMLElement;
  readonly #window: HTMLElement;
  readonly #title: HTMLElement;
  readonly #flash: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="cart"><i class="frame-fill"></i><div class="window"></div><div class="title"></div><i class="flash"></i><i class="foot"></i></div>`,
    );
    this.#cart = pick(root, ".cart");
    this.#window = pick(root, ".window");
    this.#title = pick(root, ".title");
    this.#flash = pick(root, ".flash");
    fitFrame(this.#cart, { chamfer: CHAMFER, corners: "tr-bl" });
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "pressed") {
      if (value !== null) motion(this.#flash, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 90, easing: "linear" });
      return;
    }
    const game = this.getAttribute("game") ?? "";
    const title = this.getAttribute("title") ?? game.replace(/-/g, " ");
    const art = ART[game];
    this.#cart.classList.toggle("sealed", !art);
    this.#window.classList.toggle("sealed", !art);
    this.#window.innerHTML = art ?? "";
    const printed = document.createElement("span");
    printed.className = "name";
    printed.textContent = title;
    this.#title.replaceChildren(printed);
    if (!art) {
      const soon = document.createElement("span");
      soon.className = "soon";
      soon.textContent = "SOON";
      this.#title.append(soon);
    }
    this.setAttribute("aria-label", art ? title : `${title}, coming soon`);
  }
}
