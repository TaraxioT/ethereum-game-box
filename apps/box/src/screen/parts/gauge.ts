// <egb-gauge>: gas as a bar. Sixteen upright segments of system light cover 0 to 5 gwei, one colour throughout (heat
// is not shown, so it is never mistaken for a seat), with a mono readout under them ("1.8 GWEI"). When the value
// changes, the segments that change switch one at a time from the old end toward the new, 30 ms apart.
//
// Size: it fills its box (designed at 88 × 48). Property `gwei`.
import { calm } from "../shell/dom.ts";
import { SEGMENTS, litSegments } from "./gas-level.ts";
import { pick, shadow, sheet } from "./part.ts";

const STEP_MS = 30;

const styles = sheet(`
:host { display: block; position: relative; width: 88px; height: 48px; container-type: size; }
.gauge { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.bar { display: flex; gap: 1.5px; }
.bar i {
  width: 4px; height: 16px; background: var(--sys); opacity: 0.1;
  box-shadow: 0 0 4px var(--sys-bloom), 0 0 8px var(--sys-bloom); transition: opacity 60ms linear;
}
.bar i.on { opacity: 1; }
.readout { font: 700 15px / 1 var(--mono); font-variant-numeric: tabular-nums; color: var(--fg-2); white-space: nowrap; }
`);

export class EgbGauge extends HTMLElement {
  readonly #segs: HTMLElement[];
  readonly #readout: HTMLElement;
  #lit: number | null = null;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="gauge"><div class="bar">${"<i></i>".repeat(SEGMENTS)}</div><span class="readout"></span></div>`,
    );
    this.#segs = [...pick(root, ".bar").children] as HTMLElement[];
    this.#readout = pick(root, ".readout");
  }

  set gwei(value: number) {
    const next = litSegments(value);
    const prev = this.#lit;
    this.#lit = next;
    this.#readout.textContent = `${value.toFixed(1)} GWEI`;
    this.setAttribute("aria-label", `gas ${value.toFixed(1)} gwei`);
    if (prev === null || calm()) {
      this.#segs.forEach((s, i) => {
        s.style.transitionDelay = "";
        s.classList.toggle("on", i < next);
      });
      return;
    }
    // From the old end toward the new: rising lights upward, falling puts them out downward.
    const order = next > prev ? range(prev, next) : range(next, prev).reverse();
    order.forEach((i, k) => {
      const s = this.#segs[i];
      if (!s) return;
      s.style.transitionDelay = `${k * STEP_MS}ms`;
      s.classList.toggle("on", i < next);
    });
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
