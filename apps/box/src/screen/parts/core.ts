// <egb-core>: the core, the world computer at the centre of the Grid. An outer ring of light with four notches
// pointing out, a ring of 24 segments inside it, a thin inner ring round a dark disc, and in the disc the Ethereum
// mark in wireframe. All its light is lines; nothing in it moves while it idles.
//
// Size: attributes `glass` (the inner ring's radius) and `collar` (the outer ring's), in px. The drawing centres
// itself on the element's box, which fills its parent; the shell sizes the parent to (collar + 24) × 2 round the
// core's centre. Attribute `dark`: everything at 8 % and the mark hidden (the boot holds it so until `ignite()`).
//
// `ignite()`: the segments light clockwise from 12 o'clock, then the rings, then the mark (~900 ms). `swell()`: a
// copy of the outer ring swells out and fades while the segment ring blooms once (a transaction landed, a block
// sealed). `coin()`: the mark turns once on its upright axis (a game loads).
import { ethMarkSvg } from "./eth-mark.ts";
import { motion, pick, settled, shadow, sheet } from "./part.ts";

const SEGMENTS = 24;
const SEG_OPACITY = 0.7;
const DIM = 0.08;

const styles = sheet(`
:host { display: block; position: relative; width: 100%; height: 100%; pointer-events: none; }
.core { position: absolute; inset: 0; --g: 132px; --c: 166px; }
.ring {
  position: absolute; border-radius: 50%;
  left: calc(50% - var(--r)); top: calc(50% - var(--r)); width: calc(var(--r) * 2); height: calc(var(--r) * 2);
}
/* The outer ring: a 2 px line of system light round a 1 px hot core, its bloom both sides. */
.outer, .swell {
  --r: var(--c); border: 2px solid var(--sys);
  box-shadow: 0 0 6px var(--sys-bloom), 0 0 18px var(--sys-bloom), inset 0 0 6px var(--sys-bloom);
}
.outer::after { content: ""; position: absolute; inset: -1.5px; border-radius: 50%; border: 1px solid var(--sys-hot); }
.swell { opacity: 0; }
.notches { position: absolute; inset: 0; }
.notches i {
  position: absolute; left: calc(50% - 1px); top: calc(50% - var(--c) - 10px); width: 2px; height: 10px;
  transform-origin: 1px calc(var(--c) + 10px); transform: rotate(var(--a));
  background: var(--sys-hot); box-shadow: 0 0 4px var(--sys), 0 0 10px var(--sys-bloom);
}
.segs { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.seg { fill: none; stroke: var(--sys); stroke-width: 6; opacity: ${SEG_OPACITY}; }
.bloom { opacity: 0; }
.bloom path { fill: none; stroke: var(--sys); }
/* The inner ring and the dark disc it holds. */
.disc { --r: var(--g); background: radial-gradient(circle, var(--deep), var(--void) 72%); }
.inner { --r: var(--g); border: 1px solid var(--sys); opacity: 0.5; }
/* The mark, front on, 0.95 × the glass radius tall. It turns about its upright axis for coin(). */
.mark { position: absolute; left: 50%; top: 50%; height: calc(var(--g) * 0.95 * 433 / 417); aspect-ratio: 272 / 433; transform: translate(-50%, -50%); }
.turn { width: 100%; height: 100%; }
.turn svg { display: block; width: 100%; height: 100%; overflow: visible; }

/* Dark (before ignite): every line at 8 %, the mark out. */
:host([dark]) :is(.outer, .notches, .inner, .seg) { opacity: ${DIM}; }
:host([dark]) .mark { opacity: 0; }
`);

const COIN_MS = 900;

/** The 24 segments as arcs of 10° with 5° gaps, clockwise from 12 o'clock, on a grid centred at 0,0. */
function segmentPaths(r: number): string[] {
  const at = (deg: number): string => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  };
  return Array.from({ length: SEGMENTS }, (_, i) => `M${at(i * 15 + 2.5)}A${r} ${r} 0 0 1 ${at(i * 15 + 12.5)}`);
}

export class EgbCore extends HTMLElement {
  static readonly observedAttributes = ["glass", "collar"];
  readonly #core: HTMLElement;
  readonly #segs: SVGSVGElement;
  readonly #mark: HTMLElement;
  readonly #turn: HTMLElement;
  readonly #swell: HTMLElement;
  /** What lights after the segments: the outer ring, its notches and the inner ring. */
  readonly #rings: HTMLElement[];
  #turning: Animation | null = null;
  #igniting: Promise<void> | null = null;

  constructor() {
    super();
    const notches = [0, 90, 180, 270].map((a) => `<i style="--a:${a}deg"></i>`).join("");
    const root = shadow(
      this,
      styles,
      `<div class="core">
        <i class="ring disc"></i>
        <i class="ring swell"></i><i class="ring outer"></i><div class="notches">${notches}</div>
        <svg class="segs" aria-hidden="true"></svg>
        <i class="ring inner"></i>
        <div class="mark"><div class="turn">${ethMarkSvg()}</div></div>
      </div>`,
    );
    this.#core = pick(root, ".core");
    this.#segs = pick<SVGSVGElement>(root, ".segs");
    this.#mark = pick(root, ".mark");
    this.#turn = pick(root, ".turn");
    this.#swell = pick(root, ".swell");
    this.#rings = [".outer", ".notches", ".inner"].map((s) => pick(root, s));
    this.#drawSegments(166);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    const px = Number(value);
    const prop = name === "glass" ? "--g" : "--c";
    if (value !== null && px > 0) this.#core.style.setProperty(prop, `${px}px`);
    else this.#core.style.removeProperty(prop);
    if (name === "collar" && px > 0) this.#drawSegments(px);
  }

  /** The segment ring at collar − 14, and its bloom layer under it, in a box (collar + 24) × 2 round the centre. */
  #drawSegments(collar: number): void {
    const half = collar + 24;
    const paths = segmentPaths(collar - 14);
    this.#segs.setAttribute("viewBox", `${-half} ${-half} ${half * 2} ${half * 2}`);
    this.#segs.innerHTML = `<g class="bloom">${paths.map((d) => `<path d="${d}" stroke-width="16" stroke-opacity="0.12"/><path d="${d}" stroke-width="10" stroke-opacity="0.22"/>`).join("")}</g>${paths
      .map((d) => `<path class="seg" d="${d}"/>`)
      .join("")}`;
  }

  /** A copy of the outer ring swells out and fades; the segment ring blooms once. */
  swell(): void {
    if (this.hasAttribute("dark")) return;
    const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
    motion(this.#swell, [{ opacity: 0.9, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.18)" }], { duration: 700, easing: ease });
    const bloom = this.#segs.querySelector(".bloom");
    if (bloom) motion(bloom, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
  }

  /** The mark turns once about its upright axis, like a coin, and comes back face on. */
  coin(): void {
    if (this.#turning?.playState === "running") return;
    this.#turning = motion(this.#turn, [{ transform: "perspective(900px) rotateY(0deg)" }, { transform: "perspective(900px) rotateY(360deg)" }], {
      duration: COIN_MS, easing: "cubic-bezier(0.45, 0, 0.25, 1)",
    });
  }

  /** From dark: the segments light clockwise, 20 ms apart, then the rings, then the mark. Resolves when lit. */
  ignite(): Promise<void> {
    if (this.#igniting) return this.#igniting;
    if (!this.hasAttribute("dark")) return Promise.resolve();
    this.removeAttribute("dark");
    const up = (node: Element, delay: number, duration: number, from: number, to: number): Animation | null =>
      motion(node, [{ opacity: from }, { opacity: to }], { delay, duration, easing: "linear", fill: "backwards" });
    const segs = [...this.#segs.querySelectorAll(".seg")];
    const ringsAt = segs.length * 20;
    this.#igniting = settled([
      ...segs.map((seg, i) => up(seg, i * 20, 90, DIM, SEG_OPACITY)),
      ...this.#rings.map((ring, i) => up(ring, ringsAt, 150, DIM, i === 2 ? 0.5 : 1)),
      up(this.#mark, ringsAt + 150, 300, 0, 1),
    ]).then(() => {
      this.#igniting = null;
    });
    return this.#igniting;
  }
}
