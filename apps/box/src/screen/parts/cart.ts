// <egb-cart game="…">: a game's program in the rack. A chamfered frame (cut top right and bottom left) round an art
// window with a faint inner grid and the game's art drawn in light, and the title under it. A game with no art yet
// (Bet on X, B17) is sealed: the window hatched, the title dim, a small SOON tag; its frame never goes above 50 %.
// `new-game` is the blank program that opens the game builder: an empty dashed frame and a plus in its window. A built
// game brings its own art: `icon`, its icon.svg from the Box, fills the window, held still; one whose bundle failed is
// `sealed`: hatched again, with a SEALED tag.
//
// Over the window a thin header carries the slot's number (`slot`, PRG 01…) and three status lights; along the foot of
// the frame runs a strip of light; the cartridge's reflection lies on the floor's gloss under it.
//
// Size: it fills its box (designed at 176 × 186). Attributes: `game` (a team game, `new-game`, or a built game's id),
// `title` (the printed title), `icon` (a built game's art URL), `sealed`, `slot`, `focused` (it
// lifts 12 px on a spring, and only once it has risen its frame lights with its bloom, a hot foot bar shows and the
// title brightens; losing focus it drops back and dims), `pressed` (the launch: the frame flashes white and the
// cartridge settles 6 px).
import { chamferClip, fitFrame } from "./frame.ts";
import { motion, pick, shadow, sheet } from "./part.ts";
import { stillIcon } from "./still-icon.ts";

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
  // A pool's x·y = k curve in hot outline, and Player 1's and Player 2's candles read off it.
  "stock-duel-uniswap": `<svg viewBox="0 0 120 64" aria-hidden="true">
    <path class="bloom" d="M14 6C22 44 50 56 106 58"/>
    <path class="hot" d="M14 6C22 44 50 56 106 58"/>
    <g class="o"><path d="M42 12V20M42 36V42"/><rect x="36" y="20" width="12" height="16"/></g>
    <g class="c"><path d="M74 4V10M74 30V36"/><rect x="68" y="10" width="12" height="20"/></g>
  </svg>`,
  // The hall (TITLES & CUPS): a cup in brass light between two crowns, a star over it.
  hall: `<svg viewBox="0 0 120 64" aria-hidden="true">
    <path class="bloom" d="M48 8h24v12a12 12 0 0 1-24 0Z"/>
    <path class="gold" d="M48 8h24v12a12 12 0 0 1-24 0ZM48 11h-7v3a7 7 0 0 0 7 7M72 11h7v3a7 7 0 0 1-7 7M60 32v12M52 48h16M55 44h10"/>
    <path class="hot" d="M16 30l3-9 5 5 4-7 4 7 5-5 3 9ZM83 30l3-9 5 5 4-7 4 7 5-5 3 9Z"/>
    <path class="spark" d="M60 1v4M57 3h6M16 40h20M84 40h20"/>
  </svg>`,
  // The blank program (NEW GAME on the Box): nothing in its window yet but a dashed frame waiting for art, and a plus.
  "new-game": `<svg viewBox="0 0 120 64" aria-hidden="true">
    <rect class="blank" x="36" y="4" width="48" height="56"/>
    <path class="bloom" d="M60 18v28M46 32h28"/>
    <path class="hot" d="M60 18v28M46 32h28"/>
  </svg>`,
};

const styles = sheet(`
:host { display: block; position: relative; width: 176px; height: 186px; container-type: size; cursor: pointer; }
.cart {
  --p: calc(100cqw / 176); position: absolute; inset: 0;
  transition: transform 200ms var(--ease-out);
  -webkit-box-reflect: below calc(14 * var(--p)) linear-gradient(transparent 62%, rgb(255 255 255 / 0.16));
}
.frame-fill { position: absolute; inset: 0; background: var(--glass); clip-path: ${chamferClip(CHAMFER, "tr-bl")}; }
.flash { position: absolute; inset: 0; background: var(--sys-hot); opacity: 0; clip-path: ${chamferClip(CHAMFER, "tr-bl")}; }
.frame-line { opacity: 0.3; transition: opacity 200ms linear; }
.frame-bloom { opacity: 0; transition: opacity 200ms linear; }

/* The header: the slot's number and three status lights, over a hairline. */
.head {
  position: absolute; left: calc(14 * var(--p)); right: calc(26 * var(--p)); top: calc(10 * var(--p)); height: calc(14 * var(--p));
  display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgb(207 232 246 / 0.12);
  font: 600 max(9px, calc(9 * var(--p))) / 1 var(--mono); letter-spacing: 0.2em; color: var(--fg-3);
}
.leds { display: flex; gap: calc(3 * var(--p)); }
.leds i { width: calc(5 * var(--p)); height: calc(3 * var(--p)); background: var(--fg-4); transition: background 180ms linear 300ms, box-shadow 180ms linear 300ms; }
/* The art window: under the header, a faint 16 px grid behind the art, lit from below. */
.window {
  position: absolute; left: calc(12 * var(--p)); right: calc(12 * var(--p)); top: calc(30 * var(--p)); height: calc(58% - 30 * var(--p));
  background:
    radial-gradient(ellipse 70% 60% at 50% 100%, rgb(74 168 232 / 0.14), transparent 70%),
    repeating-linear-gradient(0deg, rgb(207 232 246 / 0.06) 0 1px, transparent 1px 16px),
    repeating-linear-gradient(90deg, rgb(207 232 246 / 0.06) 0 1px, transparent 1px 16px),
    rgb(0 3 8 / 0.6);
  box-shadow: inset 0 0 0 1px rgb(207 232 246 / 0.12), inset 0 0 18px rgb(0 0 0 / 0.8);
}
.window svg { position: absolute; inset: calc(6 * var(--p)); width: calc(100% - 12 * var(--p)); height: calc(100% - 12 * var(--p)); overflow: visible; }
.bloom { fill: none; stroke: var(--sys-glow); stroke-width: 7; stroke-opacity: 0.35; stroke-linejoin: round; }
.hot { fill: none; stroke: var(--sys-hot); stroke-width: 2; stroke-linejoin: round; }
.spark { fill: none; stroke: var(--sys); stroke-width: 2; stroke-linecap: round; }
.o { stroke: var(--p1); }
.c { stroke: var(--p2); }
.o, .c { fill: none; stroke-width: 2; }
.gold { fill: none; stroke: var(--brass-hi); stroke-width: 2; stroke-linejoin: round; }
.blank { fill: none; stroke: var(--sys); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.5; }
/* A built game's icon: its own art on its own background, filling the window. */
.window img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
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
/* The strip of light along the frame's foot: faint at rest, lit with the frame. */
.strip {
  position: absolute; left: calc(26 * var(--p)); width: 46%; bottom: calc(5 * var(--p)); height: 2px;
  background: linear-gradient(90deg, var(--sys-hot), var(--sys) 70%, transparent);
  box-shadow: 0 0 6px var(--sys-bloom); opacity: 0.25; transition: opacity 200ms linear;
}
.cart.sealed .strip { opacity: 0.1; }
/* The hot foot bar under the frame, shown once the cartridge has risen. */
.foot {
  position: absolute; left: calc(24 * var(--p)); right: calc(24 * var(--p)); bottom: calc(-8 * var(--p)); height: 2px;
  background: var(--sys-hot); box-shadow: 0 0 6px var(--sys-bloom), 0 0 14px var(--sys-bloom); opacity: 0; transition: opacity 200ms linear;
}

/* Focused: it lifts on a spring; only once it is up do its frame, foot and title light. */
:host([focused]) .cart { transform: translateY(calc(-12 * var(--p))); transition: transform var(--t-move) var(--ease-spring); }
:host([focused]) :is(.frame-line, .frame-bloom, .foot, .name, .strip) { opacity: 1; transition: opacity 180ms linear 300ms; }
:host([focused]) .leds i { background: var(--sys-hot); box-shadow: 0 0 4px var(--sys-glow); }
:host([focused]) .leds i:last-child { background: var(--sys-glow); }
:host([focused]) .cart.sealed .frame-line { opacity: 0.5; }
:host([focused]) .cart.sealed :is(.frame-bloom, .foot, .strip) { opacity: 0; }
:host([focused]) .cart.sealed .leds i { background: var(--fg-4); box-shadow: none; }
/* Pressed: it settles 6 px from where it stood. */
:host([pressed]) .cart { transform: translateY(calc(-6 * var(--p))); transition: transform 140ms var(--ease-in); }
`);

export class EgbCart extends HTMLElement {
  static readonly observedAttributes = ["game", "title", "icon", "sealed", "slot", "pressed"];
  readonly #cart: HTMLElement;
  readonly #window: HTMLElement;
  readonly #title: HTMLElement;
  readonly #flash: HTMLElement;
  readonly #slot: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="cart"><i class="frame-fill"></i><div class="head"><span class="slot"></span><span class="leds"><i></i><i></i><i></i></span></div><div class="window"></div><div class="title"></div><i class="strip"></i><i class="flash"></i><i class="foot"></i></div>`,
    );
    this.#cart = pick(root, ".cart");
    this.#window = pick(root, ".window");
    this.#title = pick(root, ".title");
    this.#flash = pick(root, ".flash");
    this.#slot = pick(root, ".slot");
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
    if (name === "slot") {
      this.#slot.textContent = value ? `PRG ${value.padStart(2, "0")}` : "";
      return;
    }
    const game = this.getAttribute("game") ?? "";
    const title = this.getAttribute("title") ?? game.replace(/-/g, " ");
    const sealed = this.hasAttribute("sealed");
    const icon = this.getAttribute("icon");
    const drawn = sealed ? undefined : ART[game];
    const art = drawn ?? (sealed || !icon ? undefined : `<img alt="" draggable="false">`);
    this.#cart.classList.toggle("sealed", !art);
    this.#window.classList.toggle("sealed", !art);
    this.#window.innerHTML = art ?? "";
    if (art && !drawn && icon) this.#showIcon(pick<HTMLImageElement>(this.#window, "img"), icon);
    const printed = document.createElement("span");
    printed.className = "name";
    printed.textContent = title;
    this.#title.replaceChildren(printed);
    if (!art) {
      const soon = document.createElement("span");
      soon.className = "soon";
      soon.textContent = sealed ? "SEALED" : "SOON";
      this.#title.append(soon);
    }
    this.setAttribute("aria-label", art ? title : `${title}, ${sealed ? "sealed" : "coming soon"}`);
  }

  /** Shows the icon as a still (`still-icon.ts`); if that fails, the icon as it is. Set as a property, never written
   * into the markup: the URL is the server's, but it is still data. */
  #showIcon(img: HTMLImageElement, icon: string): void {
    const show = (src: string): void => {
      // A newer render has replaced this image.
      if (this.#window.contains(img)) img.src = src;
    };
    stillIcon(icon).then(show, () => show(icon));
  }
}
