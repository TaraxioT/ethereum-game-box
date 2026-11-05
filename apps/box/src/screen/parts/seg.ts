// <egb-seg>: a seven-segment LCD readout. Every cell shows its unlit ghost segments under the lit ones, as a real LCD
// does; a point or comma lights the decimal mark of the cell before it. When the value changes, each changed digit
// rolls in turn, left to right, 70 ms apart (the old digit rolls up and out, the new one up and in).
//
// Size: `font-size` is the cell height. Attributes: `tone` (amber, the default, or mint), `digits` (the fewest cells
// it shows; the value is right-aligned and blank cells stay ghosts). Property: `value` (the text: digits, space, '-',
// '.' and ',').
import { motion, pick, shadow, sheet } from "./part.ts";

type Segment = "a" | "b" | "c" | "d" | "e" | "f" | "g";

/** One cell on a 16.5 × 24 grid: segment thickness, the gap at each joint, and the digit's frame. */
const T = 2.1;
const H = T / 2;
const GAP = 0.45;
const LEFT = 2.2;
const RIGHT = 11.2;
const TOP = 2;
const MID = 11;
const BOTTOM = 20;

const n = (x: number): string => String(Math.round(x * 100) / 100);
const across = (y: number, x0: number, x1: number): string =>
  `${n(x0)},${n(y)} ${n(x0 + H)},${n(y - H)} ${n(x1 - H)},${n(y - H)} ${n(x1)},${n(y)} ${n(x1 - H)},${n(y + H)} ${n(x0 + H)},${n(y + H)}`;
const down = (x: number, y0: number, y1: number): string =>
  `${n(x)},${n(y0)} ${n(x + H)},${n(y0 + H)} ${n(x + H)},${n(y1 - H)} ${n(x)},${n(y1)} ${n(x - H)},${n(y1 - H)} ${n(x - H)},${n(y0 + H)}`;

const SEGMENTS: Record<Segment, string> = {
  a: across(TOP, LEFT + GAP, RIGHT - GAP),
  b: down(RIGHT, TOP + GAP, MID - GAP),
  c: down(RIGHT, MID + GAP, BOTTOM - GAP),
  d: across(BOTTOM, LEFT + GAP, RIGHT - GAP),
  e: down(LEFT, MID + GAP, BOTTOM - GAP),
  f: down(LEFT, TOP + GAP, MID - GAP),
  g: across(MID, LEFT + GAP, RIGHT - GAP),
};

const GLYPHS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
  "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "",
};

const DOT = `<rect x="13" y="18.9" width="2.2" height="2.2" rx=".5"/>`;
const TAIL = `<path d="M14.6 21.1 13.5 23.4h-1.1l.9-2.3z"/>`;

type Mark = "" | "." | ",";

interface Cell {
  readonly glyph: string;
  readonly mark: Mark;
}

const polys = (segments: string): string =>
  [...segments].map((s) => `<polygon points="${SEGMENTS[s as Segment]}"/>`).join("");

/** Slanted a little, like a real LCD: the top leans right. */
const cellSvg = (cls: string, body: string): string =>
  `<svg class="${cls}" viewBox="0 0 16.5 24" aria-hidden="true"><g transform="translate(2.1 0) skewX(-6)">${body}</g></svg>`;

const GHOST = cellSvg("ghost", polys("abcdefg") + DOT);

function litSvg(cell: Cell): string {
  const shape = polys(GLYPHS[cell.glyph] ?? "") + (cell.mark ? DOT : "") + (cell.mark === "," ? TAIL : "");
  return cellSvg("on", `<g class="halo">${shape}</g><g class="core">${shape}</g>`);
}

function cellsOf(text: string): Cell[] {
  const cells: Cell[] = [];
  for (const ch of text) {
    if (ch === "." || ch === ",") {
      const last = cells[cells.length - 1];
      if (last && !last.mark) cells[cells.length - 1] = { glyph: last.glyph, mark: ch };
      else cells.push({ glyph: " ", mark: ch });
    } else cells.push({ glyph: ch in GLYPHS ? ch : " ", mark: "" });
  }
  return cells;
}

const STEP_MS = 70;

const styles = sheet(`
:host { display: inline-flex; vertical-align: middle; height: 1em; font-size: 24px; line-height: 1; color: var(--lcd-amber); }
:host([tone="mint"]) { color: var(--lcd-mint); }
.row { display: flex; height: 100%; }
.cell { position: relative; width: .69em; height: 1em; overflow: hidden; margin-right: -.04em; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ghost { fill: currentColor; opacity: .1; }
.lit { position: absolute; inset: 0; }
.halo { fill: currentColor; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; opacity: .3; }
.core { fill: color-mix(in srgb, currentColor 76%, #fff); }
`);

interface Slot {
  readonly el: HTMLElement;
  lit: HTMLElement;
  key: string;
}

export class EgbSeg extends HTMLElement {
  static readonly observedAttributes = ["digits"];
  readonly #row: HTMLElement;
  #slots: Slot[] = [];
  #text = "";

  constructor() {
    super();
    this.#row = pick(shadow(this, styles, `<span class="row"></span>`), ".row");
  }

  connectedCallback(): void {
    if (!this.hasAttribute("role")) this.setAttribute("role", "img");
    this.#render(false);
  }

  attributeChangedCallback(): void {
    this.#render(false);
  }

  get value(): string {
    return this.#text;
  }

  set value(text: string) {
    if (text === this.#text) return;
    this.#text = text;
    this.setAttribute("aria-label", text.trim());
    this.#render(true);
  }

  #render(roll: boolean): void {
    const cells = cellsOf(this.#text);
    const want = Math.max(Number(this.getAttribute("digits")) || 0, cells.length);
    while (cells.length < want) cells.unshift({ glyph: " ", mark: "" });
    if (want !== this.#slots.length) {
      this.#slots = cells.map((cell) => this.#cell(cell));
      this.#row.replaceChildren(...this.#slots.map((s) => s.el));
      return;
    }
    let order = 0;
    cells.forEach((cell, i) => {
      const slot = this.#slots[i];
      const key = cell.glyph + cell.mark;
      if (!slot || slot.key === key) return;
      slot.key = key;
      this.#swap(slot, cell, roll ? order++ * STEP_MS : null);
    });
  }

  #cell(cell: Cell): Slot {
    const el = document.createElement("span");
    el.className = "cell";
    el.innerHTML = GHOST;
    const lit = this.#lit(cell);
    el.append(lit);
    return { el, lit, key: cell.glyph + cell.mark };
  }

  #lit(cell: Cell): HTMLElement {
    const lit = document.createElement("span");
    lit.className = "lit";
    lit.innerHTML = litSvg(cell);
    return lit;
  }

  /** Puts the cell's new digit in; with a delay, the old one rolls out and the new one rolls in after it. */
  #swap(slot: Slot, cell: Cell, delay: number | null): void {
    const old = slot.lit;
    const fresh = this.#lit(cell);
    slot.lit = fresh;
    slot.el.append(fresh);
    for (const a of old.getAnimations()) a.finish();
    const out =
      delay === null
        ? null
        : motion(old, [{ transform: "none", opacity: 1 }, { transform: "translateY(-46%)", opacity: 0 }], {
            duration: 170, delay, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards",
          });
    if (!out || delay === null) {
      old.remove();
      return;
    }
    void out.finished.then(() => old.remove(), () => old.remove());
    motion(fresh, [{ transform: "translateY(46%)", opacity: 0 }, { transform: "none", opacity: 1 }], {
      duration: 210, delay: delay + 60, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards",
    });
  }
}
