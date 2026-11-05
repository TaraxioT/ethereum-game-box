// <egb-key>: a physical key. `brass` (the default; Play and every primary key): a bright bevelled gold frame round a
// brushed, warmer face, the label engraved into it, a bronze edge under it. `metal`: the gunmetal secondary key. A
// press has real travel: the cap goes down over its edge, so less of the edge shows.
//
// A real <button> inside (focus and keyboard work); the host dispatches a normal click. The label is the element's
// text. Size: it fills its box (the edge's depth and the label scale with its height). Attributes: `variant`
// (brass|metal), `breathe` (a slow brass light breathing round it: TAP TO START), `disabled` (dark, no travel).
import { pick, shadow, sheet } from "./part.ts";

const styles = sheet(`
:host { display: inline-block; position: relative; width: 200px; height: 72px; container-type: size; vertical-align: top; }
:host([disabled]) { pointer-events: none; }
button {
  position: absolute; inset: 0; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer;
  outline: none; touch-action: manipulation;
}
.edge, .cap, .face, .glow { position: absolute; border-radius: 16cqh; }
/* The key's thickness: the bronze edge under the cap, and its shadow on the board. */
.edge {
  left: 0; right: 0; top: 10cqh; bottom: 0;
  background: linear-gradient(180deg, #9a7226, var(--brass-edge) 45%, #3a2806);
  box-shadow: 0 0 0 1.5px #2a1b03, 0 10px 16px rgb(3 1 10 / 0.55);
}
/* The cap: the gold frame, its bevel lit along the top and left, and a thin gold light that stays on its rim. */
.cap {
  left: 0; right: 0; top: 0; bottom: 10cqh;
  background: linear-gradient(160deg, #fff4c8 0%, var(--brass-hi) 12%, var(--brass) 42%, var(--brass-mid) 72%, var(--brass-lo) 100%);
  box-shadow:
    inset 0 1.5px 0 rgb(255 255 255 / 0.75), inset 1.5px 0 0 rgb(255 250 225 / 0.35), inset 0 -1.5px 0 rgb(90 58 6 / 0.65),
    0 0 0 1.5px #3e2a06, 0 0 0 3px rgb(255 214 120 / 0.22), 0 0 8px rgb(255 205 100 / 0.26);
  transition: transform var(--t-press) var(--ease-out);
}
/* The face: brushed brass, warmer than the frame, set just below it. */
.face {
  inset: 8cqh; border-radius: 10cqh; display: grid; place-items: center; overflow: hidden;
  background:
    linear-gradient(180deg, rgb(255 250 225 / 0.28), transparent 42%, transparent 72%, rgb(70 44 0 / 0.16)),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.06) 0 1px, transparent 1px 3px, rgb(80 50 0 / 0.05) 3px 4px),
    linear-gradient(180deg, #e9cf84 0%, #d8b765 35%, #c49c4a 75%, #b38a3c 100%);
  box-shadow: inset 0 2px 3px rgb(90 58 6 / 0.5), inset 0 -1px 0 rgb(255 240 190 / 0.5);
}
/* The label, engraved: dark letters, the light catching each groove's lower edge. */
.label {
  padding: 0 0.6em; white-space: nowrap; font: 800 max(14px, 34cqh) / 1 var(--display); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--brass-ink); text-shadow: 0 1px 0 rgb(255 240 190 / 0.7), 0 -1px 0 rgb(60 40 0 / 0.45);
}
/* The breathing light: a gold line round the rim and a short glow; only its opacity moves. */
.glow { inset: -2px; opacity: 0; box-shadow: 0 0 0 2px rgb(255 226 150 / 0.75), 0 0 10px rgb(255 200 90 / 0.6); pointer-events: none; }
:host([breathe]) .glow { opacity: 1; animation: breathe 2.6s ease-in-out infinite alternate; }
@keyframes breathe { from { opacity: 0.12; } to { opacity: 1; } }

button:active .cap { transform: translateY(7cqh); }
button:focus-visible .cap { outline: 3px solid var(--neon-lav); outline-offset: 3px; }

/* Gunmetal: the same key in dark metal, its label engraved and filled with light paint. */
:host([variant="metal"]) .edge { background: linear-gradient(180deg, #2a2346, #15102a 50%, #0a0716); box-shadow: 0 0 0 1.5px #07040f, 0 10px 16px rgb(3 1 10 / 0.55); }
:host([variant="metal"]) .cap {
  background: linear-gradient(160deg, #aaa2d6 0%, #6e65a2 14%, #483f7a 48%, #30285a 100%);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.4), inset 1.5px 0 0 rgb(255 255 255 / 0.1), inset 0 -1.5px 0 rgb(0 0 0 / 0.5), 0 0 0 1.5px #0b0718;
}
:host([variant="metal"]) .face {
  background:
    linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent 45%),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.035) 0 1px, transparent 1px 3px),
    linear-gradient(180deg, #4c4380, #372f66 50%, #2b2452);
  box-shadow: inset 0 2px 3px rgb(0 0 0 / 0.5), inset 0 -1px 0 rgb(255 255 255 / 0.12);
}
:host([variant="metal"]) .label { color: #e6e0fa; text-shadow: 0 -1px 0 rgb(0 0 0 / 0.65), 0 1px 0 rgb(255 255 255 / 0.08); }
:host([variant="metal"]) .glow { box-shadow: 0 0 0 2px rgb(196 170 247 / 0.7), 0 0 10px rgb(173 143 255 / 0.5); }

/* Disabled: the brass unlit and dull, no light on the rim, no travel. */
:host([disabled]) button { cursor: default; }
:host([disabled]) .cap {
  transform: none; background: linear-gradient(160deg, #7a6a44, #574a2c 45%, #3a3120);
  box-shadow: inset 0 1.5px 0 rgb(255 255 255 / 0.18), inset 0 -1.5px 0 rgb(0 0 0 / 0.5), 0 0 0 1.5px #1a1408;
}
:host([disabled]) .face { background: repeating-linear-gradient(90deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 3px), linear-gradient(180deg, #4e4330, #3b3224); box-shadow: inset 0 2px 3px rgb(0 0 0 / 0.5); }
:host([disabled]) .label { color: #221b0e; text-shadow: 0 1px 0 rgb(255 240 190 / 0.14); }
:host([disabled]) .edge { background: linear-gradient(180deg, #3a2f18, #1e1709); }
:host([disabled]) .glow { opacity: 0; animation: none; }
:host([disabled][variant="metal"]) .cap { background: linear-gradient(160deg, #3a3460, #241e40); }
:host([disabled][variant="metal"]) .face { background: linear-gradient(180deg, #2a2348, #1f1a38); }
:host([disabled][variant="metal"]) .label { color: #5a5288; text-shadow: 0 -1px 0 rgb(0 0 0 / 0.6); }
`);

export class EgbKey extends HTMLElement {
  static readonly observedAttributes = ["disabled"];
  readonly #button: HTMLButtonElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<button type="button" part="button"><span class="edge"></span><span class="cap"><span class="face"><span class="label"><slot></slot></span></span><span class="glow"></span></span></button>`,
      { delegatesFocus: true },
    );
    this.#button = pick<HTMLButtonElement>(root, "button");
  }

  attributeChangedCallback(): void {
    this.#button.disabled = this.hasAttribute("disabled");
  }
}
