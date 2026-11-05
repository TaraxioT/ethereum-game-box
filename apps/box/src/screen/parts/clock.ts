// <egb-clock>: the chain clock, a bevelled gunmetal module hanging from the top of the Box on two short chains. Behind
// its glass, BLOCK and the head block's number in mint seven-segment digits; SEPOLIA engraved on its lower lip.
//
// Size: it fills its box (designed at 276 × 64); the chains go up out of the box's top. Property `block`: each new
// head rolls its changed digits one at a time.
import { pick, shadow, sheet } from "./part.ts";
import type { EgbSeg } from "./seg.ts";

/** A short chain: links alternating face on (a ring) and edge on (a bar), lit from the left, on a 10 × 48 grid. */
const CHAIN = (() => {
  let links = "";
  for (let i = 0; i < 6; i++) {
    const y = i * 8;
    links +=
      i % 2 === 0
        ? `<ellipse cx="5" cy="${y + 4.5}" rx="3" ry="4.6" fill="none" stroke="url(#steel)" stroke-width="1.7"/>`
        : `<rect x="4.1" y="${y + 1}" width="1.8" height="7" rx=".9" fill="url(#steel)"/>`;
  }
  return `<svg viewBox="0 0 10 48" aria-hidden="true"><defs><linearGradient id="steel" x1="0" x2="1"><stop offset="0" stop-color="#e2ddf5"/><stop offset=".45" stop-color="#8a84aa"/><stop offset="1" stop-color="#3a3456"/></linearGradient></defs>${links}</svg>`;
})();

const styles = sheet(`
:host { display: block; position: relative; width: 276px; height: 64px; container-type: size; }
.clock { --p: calc(100cqh / 64); position: absolute; inset: 0; }
.lcd-frame { border-radius: calc(12 * var(--p)); }
.lcd-glass {
  --lcd-glass: var(--lcd-mint-bg);
  left: calc(8 * var(--p)); right: calc(8 * var(--p)); top: calc(7 * var(--p)); bottom: calc(20 * var(--p)); border-radius: calc(7 * var(--p));
  display: flex; align-items: center; justify-content: center; gap: calc(10 * var(--p));
  box-shadow: inset 0 3px 7px rgb(0 0 0 / 0.72), inset 0 0 0 1px rgb(143 240 216 / 0.12), 0 1px 0 rgb(255 255 255 / 0.14), 0 -1px 0 rgb(0 0 0 / 0.4);
}
.key { font: 600 max(14px, calc(17 * var(--p))) / 1 var(--display); color: var(--lcd-mint); text-shadow: 0 0 6px rgb(143 240 216 / 0.5); }
egb-seg { font-size: calc(30 * var(--p)); }
/* SEPOLIA, cut into the frame's lower lip: dark letters with the light catching their lower edges. */
.engrave {
  position: absolute; left: 0; right: 0; bottom: 0; height: calc(20 * var(--p)); display: grid; place-items: center;
  font: 700 14px / 1 var(--display); letter-spacing: 0.24em; padding-left: 0.24em; color: #1a142f;
  text-shadow: 0 1px 0 rgb(255 255 255 / 0.24), 0 -1px 0 rgb(0 0 0 / 0.35);
}
/* The hangers: a metal tab on the frame's top, a chain from it up out of the box. */
.hanger { position: absolute; bottom: calc(100% - 3 * var(--p)); width: calc(10 * var(--p)); height: calc(48 * var(--p)); }
.hanger.l { left: calc(22% - 5 * var(--p)); }
.hanger.r { right: calc(22% - 5 * var(--p)); }
.hanger svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.tab {
  position: absolute; top: calc(-6 * var(--p)); width: calc(16 * var(--p)); height: calc(10 * var(--p)); border-radius: calc(4 * var(--p)) calc(4 * var(--p)) 0 0;
  background: radial-gradient(circle at 50% 45%, #0b0718 0 calc(1.6 * var(--p)), transparent calc(2 * var(--p))), linear-gradient(180deg, #a49bd0, #5a5088 60%, #3a3264);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4), 0 0 0 1px #0b0718;
}
.tab.l { left: calc(22% - 8 * var(--p)); }
.tab.r { right: calc(22% - 8 * var(--p)); }
`);

export class EgbClock extends HTMLElement {
  readonly #seg: EgbSeg;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="clock">
        <div class="hanger l">${CHAIN}</div><div class="hanger r">${CHAIN}</div>
        <i class="tab l"></i><i class="tab r"></i>
        <div class="lcd-frame"></div>
        <div class="lcd-glass"><span class="key">BLOCK</span></div>
        <span class="engrave">SEPOLIA</span>
      </div>`,
    );
    this.#seg = document.createElement("egb-seg") as EgbSeg;
    this.#seg.setAttribute("tone", "mint");
    this.#seg.setAttribute("digits", "8");
    pick(root, ".lcd-glass").append(this.#seg);
  }

  set block(n: number) {
    this.#seg.value = n.toLocaleString("en-US");
    this.setAttribute("aria-label", `Sepolia block ${n}`);
  }
}
