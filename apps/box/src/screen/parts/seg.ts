// <egb-seg>: a number readout in light: mono digits glowing over a row of unlit ghost cells (an `8` in each, at 10 %),
// so a short value still shows the readout's width. When the value changes its changed characters flicker in, left to
// right (`digits.ts`). The Build screen's clock, and a built game's scores, counts and timers.
//
// Size: `font-size` is the digits' height. Attributes: `tone` (`sys`, the default: the system's light; `p1` or `p2`, a
// seat's; `amber` or `mint`, warm or green light for a game's own look), `digits` (the fewest cells; the value is
// right-aligned), `value` (the text: digits, space, `-`, `.`, `,` and `:`; also a property).
import { setDigits } from "./digits.ts";
import { pick, shadow, sheet } from "./part.ts";

const styles = sheet(`
:host { --ink: var(--sys); --bloom: var(--sys-bloom); display: inline-block; position: relative; vertical-align: middle; font-size: 32px; line-height: 1; }
:host([tone="p1"]) { --ink: var(--p1); --bloom: var(--p1-bloom); }
:host([tone="p2"]) { --ink: var(--p2); --bloom: var(--p2-bloom); }
:host([tone="amber"]) { --ink: #ffb547; --bloom: rgb(255 181 71 / 0.45); }
:host([tone="mint"]) { --ink: #86eec4; --bloom: rgb(134 238 196 / 0.45); }
.row { display: block; font: 700 1em / 1 var(--mono); font-variant-numeric: tabular-nums; white-space: pre; text-align: right; }
.ghost { color: var(--ink); opacity: 0.1; }
/* The digits lie over the ghosts, right-aligned with them. They keep a layer of their own: a changed digit flickers
   in, and a part lifted onto a layer only while it animates makes the Pi's GPU raster round it as it starts and ends. */
.lit { position: absolute; inset: 0; color: var(--ink); text-shadow: 0 0 2px rgb(255 255 255 / 0.6), 0 0 8px var(--bloom); will-change: transform; }
`);

export class EgbSeg extends HTMLElement {
  static readonly observedAttributes = ["digits", "value"];
  readonly #ghost: HTMLElement;
  readonly #lit: HTMLElement;
  #text = "";

  constructor() {
    super();
    const root = shadow(this, styles, `<span class="row ghost" aria-hidden="true"></span><span class="row lit" aria-hidden="true"></span>`);
    this.#ghost = pick(root, ".ghost");
    this.#lit = pick(root, ".lit");
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "img");
    this.#draw(false);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "value") this.value = value ?? "";
    else this.#draw(false);
  }

  get value(): string {
    return this.#text;
  }

  set value(text: string) {
    if (text === this.#text) return;
    this.#text = text;
    this.setAttribute("aria-label", text.trim());
    this.#draw(true);
  }

  #draw(animate: boolean): void {
    const cells = Math.max(Number(this.getAttribute("digits")) || 0, this.#text.length);
    this.#ghost.textContent = "8".repeat(cells);
    setDigits(this.#lit, this.#text, animate);
  }
}
