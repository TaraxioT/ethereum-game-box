// <egb-clock>: the block readout. Four corner brackets of system light round BLOCK and the head block's number, with
// SEPOLIA under them. Each new block flickers its changed digits in, left to right.
//
// Size: it fills its box (designed at 276 × 64). Property `block`.
import { setDigits } from "./digits.ts";
import { pick, shadow, sheet } from "./part.ts";

const styles = sheet(`
:host { display: block; position: relative; width: 276px; height: 64px; container-type: size; }
.clock { --p: calc(100cqh / 64); position: absolute; inset: 0; }
/* The brackets: an L of light at each corner. */
.corner { position: absolute; width: calc(12 * var(--p)); height: calc(12 * var(--p)); border: 0 solid var(--sys); }
.tl { left: 0; top: 0; border-left-width: 1.5px; border-top-width: 1.5px; }
.tr { right: 0; top: 0; border-right-width: 1.5px; border-top-width: 1.5px; }
.bl { left: 0; bottom: 0; border-left-width: 1.5px; border-bottom-width: 1.5px; }
.br { right: 0; bottom: 0; border-right-width: 1.5px; border-bottom-width: 1.5px; }
.read {
  position: absolute; left: 0; right: 0; top: calc(6 * var(--p)); height: calc(34 * var(--p));
  display: flex; align-items: center; justify-content: center; gap: calc(12 * var(--p));
}
.key { font: 600 max(14px, calc(15 * var(--p))) / 1 var(--hud-body); letter-spacing: 0.08em; color: var(--fg-3); }
.num {
  /* On a layer of its own: each block's digits flicker in, and the browser would otherwise lift each onto a layer
     and drop it again, rastering the top of the screen with it on the Pi's GPU. */
  display: inline-block; will-change: transform;
  font: 700 calc(30 * var(--p)) / 1 var(--mono); font-variant-numeric: tabular-nums; color: var(--fg);
  text-shadow: var(--glow-text);
}
.chain {
  position: absolute; left: 0; right: 0; bottom: calc(6 * var(--p)); text-align: center;
  font: 600 14px / 1 var(--hud-body); letter-spacing: 0.2em; padding-left: 0.2em; color: var(--fg-4);
}
`);

export class EgbClock extends HTMLElement {
  readonly #num: HTMLElement;
  #shown = false;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="clock">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="read"><span class="key">BLOCK</span><span class="num"></span></div>
        <span class="chain">SEPOLIA</span>
      </div>`,
    );
    this.#num = pick(root, ".num");
  }

  set block(n: number) {
    setDigits(this.#num, n.toLocaleString("en-US"), this.#shown);
    this.#shown = true;
    this.setAttribute("aria-label", `Sepolia block ${n}`);
  }
}
