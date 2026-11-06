// <egb-key>: a light key. A chamfered frame of light round a dark face and a wide caps label. `primary` (the
// default; Play and every key that moves the game on): the line full with its bloom, a faint fill of its light, a
// glowing label. `ghost` (Back, Home): the line at 35 %, no bloom, a quiet label. `alert` (REFUND ALL): primary in
// red. `selected` (the chosen stake): filled solid with light, the label dark on it. `disabled`: the line at 12 %,
// the label at 25 %, no press. `breathe` (TAP TO START): the bloom breathes slowly.
//
// A real <button> inside (focus and keyboard work); the host dispatches a normal click. The label is the element's
// text, sized from the key's height and shrunk to fit its width. A press flashes the key's shape and squeezes it a
// little: there is no physical edge to travel down.
import { chamferClip, fitFrame } from "./frame.ts";
import { motion, pick, shadow, sheet } from "./part.ts";
import { facesReady } from "../shell/dom.ts";

const CHAMFER = 14;

const styles = sheet(`
:host { display: inline-block; position: relative; width: 200px; height: 72px; container-type: size; vertical-align: top; }
:host([disabled]) { pointer-events: none; }
button {
  position: absolute; inset: 0; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer;
  outline: none; touch-action: manipulation;
}
.shape { position: absolute; inset: 0; display: grid; place-items: center; transition: transform var(--t-press) var(--ease-out); }
.shape > i { position: absolute; inset: 0; clip-path: ${chamferClip(CHAMFER)}; }
.frame-fill { background: var(--glass); }
.tint { background: var(--frame-tone, var(--sys)); opacity: 0.08; }
.flash { background: var(--sys-hot); opacity: 0; }
.label {
  position: relative; padding: 0 0.7em; white-space: nowrap; text-transform: uppercase;
  font: 700 36cqh / 1 var(--hud-display); letter-spacing: 0.04em; color: var(--fg);
  text-shadow: var(--glow-text);
}
.frame-bloom { opacity: 1; }
button:active .shape { transform: scale(0.97); }
button:focus-visible .shape { outline: 2px solid var(--sys-hot); outline-offset: 5px; }

:host([variant="ghost"]) .frame-line { opacity: 0.35; }
:host([variant="ghost"]) :is(.frame-bloom, .tint) { opacity: 0; }
:host([variant="ghost"]) .label { color: var(--fg-3); text-shadow: none; }
:host([variant="alert"]) { --frame-tone: var(--alert); }
:host([variant="alert"]) .label { text-shadow: 0 0 4px rgb(255 45 61 / 0.9), 0 0 14px rgb(255 45 61 / 0.4); }

:host([selected]) .tint { opacity: 1; }
:host([selected]) .label { color: var(--void); text-shadow: none; }

:host([disabled]) button { cursor: default; }
:host([disabled]) .frame-line { opacity: 0.12; }
:host([disabled]) :is(.frame-bloom, .tint) { opacity: 0; }
:host([disabled]) .label { opacity: 0.25; text-shadow: none; }

:host([breathe]) .frame-bloom { animation: breathe 2.4s ease-in-out infinite alternate; }
@keyframes breathe { from { opacity: 0.35; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { :host([breathe]) .frame-bloom { opacity: 0.7; } }
`);

export class EgbKey extends HTMLElement {
  static readonly observedAttributes = ["disabled"];
  readonly #button: HTMLButtonElement;
  readonly #shape: HTMLElement;
  readonly #flash: HTMLElement;
  readonly #label: HTMLElement;

  constructor() {
    super();
    const root = shadow(
      this,
      styles,
      `<button type="button" part="button"><span class="shape"><i class="frame-fill"></i><i class="tint"></i><i class="flash"></i><span class="label"><slot></slot></span></span></button>`,
      { delegatesFocus: true },
    );
    this.#button = pick<HTMLButtonElement>(root, "button");
    this.#shape = pick(root, ".shape");
    this.#flash = pick(root, ".flash");
    this.#label = pick(root, ".label");
    fitFrame(this.#shape, { chamfer: CHAMFER });
    this.#button.addEventListener("pointerdown", () => this.flash());
    this.#button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") this.flash();
    });
    // The label shrinks to fit: when the key is sized, when its words change, and once the face has loaded.
    new ResizeObserver(() => this.#fit()).observe(this.#shape);
    pick(root, "slot").addEventListener("slotchange", () => this.#fit());
    void facesReady().then(() => this.#fit());
  }

  attributeChangedCallback(): void {
    this.#button.disabled = this.hasAttribute("disabled");
  }

  /** The press's flash, for a key pressed from elsewhere (Enter on Home). */
  flash(): void {
    motion(this.#flash, [{ opacity: 0 }, { opacity: 0.9, offset: 0.4 }, { opacity: 0 }], { duration: 90, easing: "linear" });
  }

  /** The label at 0.36 × the height, or smaller if that would run past the key's ends. */
  #fit(): void {
    this.#label.style.fontSize = "";
    const room = this.#shape.clientWidth;
    const natural = this.#label.scrollWidth;
    if (room > 0 && natural > room) {
      const size = parseFloat(getComputedStyle(this.#label).fontSize);
      this.#label.style.fontSize = `${Math.floor((size * room) / natural)}px`;
    }
  }
}
