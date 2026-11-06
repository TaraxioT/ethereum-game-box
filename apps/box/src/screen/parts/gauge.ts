// <egb-gauge>: the analogue gas gauge beside the chain clock. A bevelled chrome bezel round a dark dial, ticks from 0
// to 5 gwei across a 240° sweep (cold to hot), a gold fuel-pump glyph, a needle that eases to each new value over
// 1.2 s, and a small mono readout under the bezel ("1.8 GWEI").
//
// Size: the dial fills its (square) box; the readout hangs just under it. Property `gwei`.
//
// The needle sits on a layer of its own and the gauge turns it frame by frame. A compositor animation of it (a CSS
// transition or a Web Animation) makes the browser lift the parts painted after it onto layers of their own while it
// runs and merge them back when it ends, and on the Pi each of those changes rasters the screen's wide top tiles
// again: an 80–110 ms frame as the needle sets off and another as it settles, on every gas change.
import { calm } from "../shell/dom.ts";
import { cubicBezier } from "./bezier.ts";
import { pick, shadow, sheet } from "./part.ts";

const MAX_GWEI = 5;
const SWEEP = 240;
const SWING_MS = 1200;
const swing = cubicBezier(0.25, 0.9, 0.3, 1);

/** The dial's face on a 100 × 100 grid round 50,50: a tick every half gwei, the whole ones longer. */
const DIAL = (() => {
  const ramp = ["#86eec4", "#86eec4", "#9fe6a8", "#c6e68a", "#e7dc72", "#ffd06a", "#ffc46b", "#ffae55", "#ff9b3d", "#ff8048", "#ff6b6b"];
  let ticks = "";
  ramp.forEach((colour, i) => {
    const a = ((-SWEEP / 2 + (i * SWEEP) / (ramp.length - 1) - 90) * Math.PI) / 180;
    const inner = i % 2 === 0 ? 30 : 34;
    const p = (r: number): string => `${(50 + Math.cos(a) * r).toFixed(2)} ${(50 + Math.sin(a) * r).toFixed(2)}`;
    ticks += `<path d="M${p(inner)}L${p(40)}" stroke="${colour}" stroke-width="${i % 2 === 0 ? 3.2 : 2.2}" stroke-linecap="round"/>`;
  });
  const pump = `<g transform="translate(44 60)" style="fill:var(--neon-gold)"><rect width="8.6" height="12" rx="1.4"/><rect x="1.6" y="1.6" width="5.4" height="3.6" rx=".6" fill="#15102a"/><path d="M8.6 3.4h1.8l1.8 2v5.2a1.1 1.1 0 0 1-2.2 0V7" style="fill:none;stroke:var(--neon-gold)" stroke-width="1.3"/></g>`;
  return `<svg class="dial" viewBox="0 0 100 100" aria-hidden="true">${ticks}${pump}</svg>`;
})();

const styles = sheet(`
:host { display: block; position: relative; width: 80px; height: 80px; container-type: size; }
.gauge { --p: calc(100cqmin / 80); position: absolute; inset: 0; }
/* The bezel: chrome turned on a lathe, lit from the top left. */
.bezel {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 225deg, #d6d1ea, #77719a 18%, #c4bedd 36%, #5c5680 58%, #a9a3c8 80%, #d6d1ea);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.55), inset 0 -2px 0 rgb(0 0 0 / 0.35), 0 0 0 1.5px #0b0718, 0 8px 14px rgb(3 1 10 / 0.55);
}
.face {
  position: absolute; inset: calc(7 * var(--p)); border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #2a2448, #14102a 75%);
  box-shadow: inset 0 3px 6px rgb(0 0 0 / 0.75), 0 -1px 0 rgb(0 0 0 / 0.4), 0 1px 0 rgb(255 255 255 / 0.3);
}
.dial { position: absolute; inset: 0; width: 100%; height: 100%; }
/* The needle, pivoting on the dial's centre. */
.needle {
  position: absolute; left: 50%; bottom: 50%; width: calc(3.6 * var(--p)); height: 40%; margin-left: calc(-1.8 * var(--p));
  border-radius: calc(2 * var(--p)) calc(2 * var(--p)) 0 0; transform-origin: 50% 100%;
  background: linear-gradient(90deg, #ffe0a0, var(--lcd-amber) 50%, #c97a1c);
  box-shadow: 0 0 4px rgb(255 181 71 / 0.55);
  transform: rotate(-120deg); will-change: transform;
}
.hub {
  position: absolute; left: 50%; top: 50%; width: calc(12 * var(--p)); height: calc(12 * var(--p)); margin: calc(-6 * var(--p)) 0 0 calc(-6 * var(--p));
  border-radius: 50%; background: radial-gradient(circle at 35% 30%, #d6d1ea, #5a5088 60%, #2a2346); box-shadow: 0 0 0 1px #0b0718, 0 2px 3px rgb(0 0 0 / 0.5);
}
/* Glass over the dial: a sheen on the lit side. */
.face::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(155deg, rgb(255 255 255 / 0.14), transparent 45%); pointer-events: none; }
/* The readout: a small LCD plate hanging under the bezel. */
.readout {
  position: absolute; left: 50%; top: calc(100% + 4px); transform: translateX(-50%); white-space: nowrap;
  padding: 3px 8px; border-radius: 5px; font: 700 14px / 1 var(--mono); color: var(--lcd-mint); text-shadow: 0 0 5px rgb(143 240 216 / 0.45);
  background: linear-gradient(180deg, #0a2a25, var(--lcd-mint-bg)); box-shadow: inset 0 2px 4px rgb(0 0 0 / 0.7), 0 0 0 1.5px #2b2449, 0 0 0 2.5px #0b0718;
}
`);

export class EgbGauge extends HTMLElement {
  readonly #needle: HTMLElement;
  readonly #readout: HTMLElement;
  /** Where the needle points now, in degrees; null until the first value, which it points at straight away. */
  #angle: number | null = null;
  #frame = 0;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<div class="gauge"><div class="bezel"></div><div class="face">${DIAL}<i class="needle"></i><i class="hub"></i></div><span class="readout"></span></div>`,
    );
    this.#needle = pick(root, ".needle");
    this.#readout = pick(root, ".readout");
  }

  set gwei(value: number) {
    const g = Math.min(MAX_GWEI, Math.max(0, value));
    this.#swing(-SWEEP / 2 + (g / MAX_GWEI) * SWEEP);
    this.#readout.textContent = `${value.toFixed(1)} GWEI`;
    this.setAttribute("aria-label", `gas ${value.toFixed(1)} gwei`);
  }

  /** Eases the needle from where it points to `to` over 1.2 s; under reduced motion, or for the first value, it is
   * there at once. */
  #swing(to: number): void {
    cancelAnimationFrame(this.#frame);
    const from = this.#angle;
    const point = (deg: number): void => {
      this.#angle = deg;
      this.#needle.style.transform = `rotate(${deg}deg)`;
    };
    if (from === null || from === to || calm()) {
      point(to);
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / SWING_MS);
      point(from + (to - from) * swing(t));
      if (t < 1) this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }
}
