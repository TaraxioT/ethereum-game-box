// <egb-cart game="…">: a game's cartridge in the rack. A chunky gunmetal keycap set in a wider, clipped housing: a
// bevelled metal face round a big dark glass screen, the title in arcade caps across the top of the glass and the
// game's art standing on it. A game with no art yet (Bet on X, B17) is sealed: no screen, a riveted metal cover with
// the title engraved and a SOON plate.
//
// Size: it fills its box (designed at 176 × 186). Attributes: `game`, `title` (the printed title), `focused` (the
// keycap rises out of its housing on a spring, and only then a thin lavender strip lights at its foot and round the
// housing's rim; an idle cartridge has no light at all), `pressed` (the keycap seats 8 px down: the launch).
import { pick, shadow, sheet } from "./part.ts";

/** The art on each built game's glass, on a 120 × 64 grid, its foot on the glass's floor. */
const ART: Record<string, string> = {
  // A lightning bolt struck from a drawn revolver: marigold, faceted, sparks off its tips.
  "quick-draw": `<svg viewBox="0 0 120 64" aria-hidden="true">
    <defs><linearGradient id="bolt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c8"/><stop offset=".42" stop-color="#ffc46b"/><stop offset="1" stop-color="#e08a2a"/></linearGradient></defs>
    <ellipse class="floor" cx="60" cy="62" rx="26" ry="2.6"/>
    <path class="bolt-glow" d="M68 2 40 34h17l-9 28 34-36H64L76 2Z"/>
    <path d="M68 2 40 34h17l-9 28 34-36H64L76 2Z" fill="url(#bolt)" stroke="#2a1804" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M67.4 4.4 43.6 32.2M58.4 35.2 51 57.4" fill="none" stroke="#fffbe8" stroke-opacity=".75" stroke-width="1.4" stroke-linecap="round"/>
    <g class="spark"><path d="M34 14l-7-5M30 24h-8M86 12l7-6M92 22h8M88 40l6 4"/></g>
  </svg>`,
  // Candlesticks climbing, Player 1's orange against Player 2's cyan.
  "stock-duel": `<svg viewBox="0 0 120 64" aria-hidden="true">
    <ellipse class="floor" cx="60" cy="62" rx="44" ry="2.4"/>
    ${(
      [
        [22, 36, 52, 30, 58, "o"],
        [37, 28, 44, 22, 50, "c"],
        [52, 32, 46, 25, 52, "o"],
        [67, 18, 36, 12, 42, "c"],
        [82, 22, 34, 15, 40, "o"],
        [97, 7, 26, 2, 32, "c"],
      ] as const
    )
      .map(
        ([x, top, bottom, wickTop, wickBottom, seat]) =>
          `<g class="${seat}"><path class="wick" d="M${x} ${wickTop}V${wickBottom}"/><rect class="candle" x="${x - 5}" y="${top}" width="10" height="${bottom - top}" rx="1.6"/><rect class="lit" x="${x - 4}" y="${top + 1}" width="2.2" height="${bottom - top - 2}" rx="1"/></g>`,
      )
      .join("")}
  </svg>`,
};

const RIVETS = `<i class="rivet tl"></i><i class="rivet tr"></i><i class="rivet bl"></i><i class="rivet br"></i>`;

const styles = sheet(`
:host { display: block; position: relative; width: 176px; height: 186px; container-type: size; cursor: pointer; }
.cart { --p: calc(100cqw / 176); position: absolute; inset: 0; }

/* The housing: dark gunmetal lit along its top edge, a deep well where the keycap's stems go, metal clips at its
   sides, its shadow on the board. */
.housing {
  position: absolute; left: 0; right: 0; top: calc(34 * var(--p)); bottom: 0; border-radius: calc(16 * var(--p));
  background: linear-gradient(180deg, #4a4566 0%, #34304e 12%, #262240 60%, #1c1830 100%);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.22), inset 0 -2px 0 rgb(0 0 0 / 0.4), 0 0 0 1.5px #0b0818, 0 12px 16px rgb(3 1 10 / 0.6);
}
.well {
  position: absolute; inset: calc(10 * var(--p)); border-radius: calc(11 * var(--p));
  background: linear-gradient(180deg, #06040c, #0e0b19 65%, #16122a);
  box-shadow: inset 0 6px 10px rgb(0 0 0 / 0.85), inset 0 0 0 1px rgb(0 0 0 / 0.6), 0 1px 0 rgb(255 255 255 / 0.08);
}
.clip {
  position: absolute; top: calc(22 * var(--p)); width: calc(9 * var(--p)); height: calc(36 * var(--p)); border-radius: calc(3 * var(--p));
  background: linear-gradient(90deg, #5a5576, #a39dc0 35%, #6a6488 70%, #3a3552);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -1.5px 0 rgb(0 0 0 / 0.45), 0 0 0 1px #0b0818, 0 3px 4px rgb(0 0 0 / 0.5);
}
.clip.l { left: calc(-5 * var(--p)); }
.clip.r { right: calc(-5 * var(--p)); }
/* The housing's rim and well, lit lavender while the keycap stands raised. */
.rim {
  position: absolute; inset: 0; border-radius: inherit; opacity: 0; pointer-events: none;
  box-shadow: 0 0 0 1.5px #0b0818, 0 0 0 3px #d8c8ff, 0 0 8px rgb(173 143 255 / 0.5);
  transition: opacity 160ms linear;
}
.rim::after {
  content: ""; position: absolute; inset: calc(10 * var(--p)); border-radius: calc(11 * var(--p));
  box-shadow: inset 0 0 0 1.5px rgb(216 200 255 / 0.8), inset 0 0 10px rgb(173 143 255 / 0.4);
}

/* The keycap. */
.cap {
  position: absolute; left: calc(13 * var(--p)); right: calc(13 * var(--p)); top: calc(10 * var(--p)); height: calc(150 * var(--p));
  transition: transform var(--t-move) var(--ease-spring);
}
/* Its skirt: the darker band under the face, a lit lower lip, a crisp outline and a short shadow into the housing. */
.skirt {
  position: absolute; inset: 0; border-radius: calc(18 * var(--p)) calc(18 * var(--p)) calc(16 * var(--p)) calc(16 * var(--p));
  background: linear-gradient(180deg, #3e3a54 60%, #2a273a);
  box-shadow: inset 0 -2px 0 rgb(255 255 255 / 0.18), 0 0 0 1.5px #0b0818, 0 5px 4px rgb(3 1 10 / 0.7), 0 14px 14px -4px rgb(3 1 10 / 0.55);
}
/* The top face: brushed metal lit from the top left, a bright bevel along its top and left edges. */
.face {
  position: absolute; left: calc(3 * var(--p)); right: calc(3 * var(--p)); top: calc(3 * var(--p)); bottom: calc(20 * var(--p));
  border-radius: calc(15 * var(--p)) calc(15 * var(--p)) calc(12 * var(--p)) calc(12 * var(--p));
  background:
    linear-gradient(135deg, rgb(255 255 255 / 0.18), transparent 42%),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #a6a3bc 0%, #8a879f 16%, #6c6982 55%, #55526a 100%);
  box-shadow: inset 0 2px 0 rgb(255 255 255 / 0.5), inset 2px 0 0 rgb(255 255 255 / 0.14), inset -2px 0 0 rgb(0 0 0 / 0.18), inset 0 -2px 0 rgb(0 0 0 / 0.3);
}
/* The strip of light at the keycap's foot, seen once it has risen. */
.strip {
  position: absolute; left: calc(10 * var(--p)); right: calc(10 * var(--p)); bottom: calc(-3 * var(--p)); height: calc(2.5 * var(--p));
  border-radius: 2px; opacity: 0; background: #efe6ff; box-shadow: 0 0 2px #ad8fff, 0 0 7px rgb(173 143 255 / 0.85);
  transition: opacity 160ms linear;
}

/* The screen: dark glass set into the face, shadowed under the bezel above it, lit along its bottom. */
.glass {
  position: absolute; left: calc(10 * var(--p)); right: calc(10 * var(--p)); top: calc(10 * var(--p)); bottom: calc(12 * var(--p));
  border-radius: calc(10 * var(--p)); overflow: hidden;
  background: radial-gradient(90% 75% at 50% 38%, #1d1a2c, #0d0b15 80%);
  box-shadow:
    inset 0 0 0 1.5px rgb(4 2 10 / 0.9), inset 0 5px 9px rgb(0 0 0 / 0.65),
    0 -1.5px 0 1.5px rgb(0 0 0 / 0.25), 0 1.5px 0 1.5px rgb(255 255 255 / 0.22);
}
.title {
  position: absolute; z-index: 2; left: calc(5 * var(--p)); right: calc(5 * var(--p)); top: calc(8 * var(--p));
  font: 900 max(14px, calc(19 * var(--p))) / 0.98 var(--display); text-transform: uppercase; text-align: center; text-wrap: balance; color: #efeaf8;
  /* Arcade lettering: a dark outline and a drop under it. */
  text-shadow:
    1.5px 0 0 #0b0914, -1.5px 0 0 #0b0914, 0 1.5px 0 #0b0914, 0 -1.5px 0 #0b0914,
    1px 1px 0 #0b0914, -1px 1px 0 #0b0914, 1px -1px 0 #0b0914, -1px -1px 0 #0b0914, 0 3px 0 #05040a;
}
.art { position: absolute; z-index: 1; left: 0; right: 0; bottom: calc(2 * var(--p)); height: calc(58 * var(--p)); }
.art svg { display: block; width: 100%; height: 100%; overflow: visible; }
.floor { fill: #ad8fff; opacity: 0.12; }
.bolt-glow { fill: none; stroke: var(--neon-gold); stroke-width: 5; stroke-linejoin: round; opacity: 0.22; }
.spark path { fill: none; stroke: #ffe3a1; stroke-width: 2.4; stroke-linecap: round; }
.o { --tone: var(--p1); --tone-hi: var(--p1-hi); }
.c { --tone: var(--p2); --tone-hi: var(--p2-hi); }
.wick { stroke: var(--tone); stroke-width: 2; stroke-linecap: round; }
.candle { fill: var(--tone); stroke: #0b0914; stroke-width: 1; }
.lit { fill: var(--tone-hi); opacity: 0.85; }
/* A reflection across the glass's top, and a veil that dims an idle screen a little. */
.glass::after { content: ""; position: absolute; z-index: 3; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(165deg, rgb(255 255 255 / 0.1), transparent 32%); }
.veil { position: absolute; z-index: 3; inset: 0; background: #0a0814; opacity: 0.2; transition: opacity 160ms linear; pointer-events: none; }

/* Sealed: a riveted cover where the screen would be, the title engraved, a SOON plate. */
.cover {
  position: absolute; left: calc(10 * var(--p)); right: calc(10 * var(--p)); top: calc(10 * var(--p)); bottom: calc(12 * var(--p));
  border-radius: calc(9 * var(--p)); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(9 * var(--p));
  background:
    linear-gradient(135deg, rgb(255 255 255 / 0.16), transparent 45%),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 3px),
    linear-gradient(170deg, #8e8ba4, #6c6982 40%, #55526b);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.38), inset 0 -1.5px 0 rgb(0 0 0 / 0.35), 0 0 0 1.5px #1a1726, 0 2px 3px rgb(0 0 0 / 0.45);
}
.etched {
  padding: 0 calc(10 * var(--p)); font: 900 max(14px, calc(18 * var(--p))) / 1 var(--display); text-transform: uppercase; text-align: center;
  color: #34314a; text-shadow: 0 1px 0 rgb(255 255 255 / 0.3), 0 -1px 0 rgb(0 0 0 / 0.4);
}
.cover egb-plate { font-size: max(14px, calc(14 * var(--p))); padding: .45em 1.5em; }
.rivet {
  position: absolute; width: calc(8 * var(--p)); height: calc(8 * var(--p)); border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f1eefb, #a9a5c0 35%, #5d5878 75%, #34304a);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45), 0 1px 0 1px rgb(255 255 255 / 0.12);
}
.rivet.tl { left: calc(6 * var(--p)); top: calc(6 * var(--p)); }
.rivet.tr { right: calc(6 * var(--p)); top: calc(6 * var(--p)); }
.rivet.bl { left: calc(6 * var(--p)); bottom: calc(6 * var(--p)); }
.rivet.br { right: calc(6 * var(--p)); bottom: calc(6 * var(--p)); }

/* Focused: the keycap rises on a spring; the strip and the rim light only once it is up. */
:host([focused]) .cap { transform: translateY(calc(-16 * var(--p))); }
:host([focused]) :is(.strip, .rim) { opacity: 1; transition: opacity 220ms linear 300ms; }
:host([focused]) .veil { opacity: 0; }
/* Pressed: the keycap seats home in its housing. */
:host([pressed]) .cap { transform: translateY(calc(8 * var(--p))); transition: transform 140ms var(--ease-in); }
`);

export class EgbCart extends HTMLElement {
  static readonly observedAttributes = ["game", "title"];
  readonly #face: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="cart">
        <div class="housing"><i class="well"></i><i class="clip l"></i><i class="clip r"></i><i class="rim"></i></div>
        <div class="cap"><div class="skirt"></div><div class="face"></div><i class="strip"></i></div>
      </div>`,
    );
    this.#face = pick(root, ".face");
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
  }

  attributeChangedCallback(): void {
    const game = this.getAttribute("game") ?? "";
    const title = this.getAttribute("title") ?? game.replace(/-/g, " ");
    const art = ART[game];
    this.#face.innerHTML = art
      ? `<div class="glass"><span class="title"></span><div class="art">${art}</div><i class="veil"></i></div>`
      : `<div class="cover">${RIVETS}<span class="etched"></span><egb-plate variant="brass">SOON</egb-plate></div>`;
    pick(this.#face, art ? ".title" : ".etched").textContent = title;
  }
}
