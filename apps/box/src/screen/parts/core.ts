// <egb-core>: the core, the world computer at the centre of the Grid. An outer ring of light with four notches
// pointing out, a ring of 24 segments inside it, a thin inner ring round a dark disc, and in the disc the Ethereum
// mark in wireframe. Round it, the instrument's detail: a soft blue halo on the air behind it, a dial of fine ticks
// outside the ring, and two broken orbit rings that turn very slowly (transform only), one outside the ring and one
// inside the glass, with a ring of small printed words. The glass is lit from inside and catches a sheen at its top
// left. All its light is lines.
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
/* What moves on every block keeps a layer of its own: the swell, the segments' bloom, and the mark that turns. A
   part the browser lifts onto a layer only while it animates makes the Pi's GPU raster the core and the wide tiles
   over it again as the motion starts and again as it ends (80–150 ms frames). */
.swell { will-change: transform, opacity; }
.notches { position: absolute; inset: 0; }
.notches i {
  position: absolute; left: calc(50% - 1px); top: calc(50% - var(--c) - 10px); width: 2px; height: 10px;
  transform-origin: 1px calc(var(--c) + 10px); transform: rotate(var(--a));
  background: var(--sys-hot); box-shadow: 0 0 4px var(--sys), 0 0 10px var(--sys-bloom);
}
.segs, .bloom { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.seg { opacity: ${SEG_OPACITY}; }
.seg path { fill: none; }
.seg .s-glow { stroke: var(--sys-glow); stroke-width: 12; stroke-opacity: 0.18; }
.seg .s-line { stroke: var(--sys); stroke-width: 6; }
.seg .s-hot { stroke: var(--sys-hot); stroke-width: 1.5; }
.bloom { opacity: 0; will-change: opacity; }
.bloom path { fill: none; stroke: var(--sys); }
/* The halo: the core's light on the air round it. */
.halo { --r: calc(var(--c) * 1.7); background: radial-gradient(circle, rgb(74 168 232 / 0.2), rgb(74 168 232 / 0.07) 45%, transparent 70%); }
/* The inner ring and the glass it holds: lit blue from deep inside, fine rings in it, a sheen at its top left. */
.disc {
  --r: var(--g);
  background:
    radial-gradient(ellipse 60% 40% at 34% 22%, rgb(200 235 255 / 0.1), transparent 70%),
    repeating-radial-gradient(circle, transparent 0 9px, rgb(120 190 240 / 0.05) 9px 10px),
    radial-gradient(circle, #0c3150, #061a2c 38%, var(--void) 78%);
  box-shadow: inset 0 0 24px rgb(0 0 0 / 0.9);
}
.detail { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.dial line { stroke: var(--sys); stroke-width: 1; }
.dial { opacity: 0.4; }
.orbit { position: absolute; inset: 0; will-change: transform; animation: orbit 90s linear infinite; }
.orbit.in { animation-duration: 140s; animation-direction: reverse; }
.orbit svg { display: block; width: 100%; height: 100%; overflow: visible; }
.orbit path { fill: none; stroke: var(--sys); stroke-linecap: butt; }
.orbit .arc { stroke-width: 2; opacity: 0.55; }
.orbit .arc-hot { stroke: var(--sys-hot); stroke-width: 1; }
.orbit .dash { stroke-width: 1; stroke-dasharray: 2 6; opacity: 0.35; }
.script { opacity: 0.55; }
.script text { font: 600 9px var(--mono); letter-spacing: 0.32em; fill: var(--fg-2); }
@keyframes orbit { to { transform: rotate(360deg); } }
.inner { --r: var(--g); border: 1px solid var(--sys); opacity: 0.5; }
/* The mark, front on, 0.95 × the glass radius tall. It turns about its upright axis for coin(). */
.mark { position: absolute; left: 50%; top: 50%; height: calc(var(--g) * 0.95 * 433 / 417); aspect-ratio: 272 / 433; transform: translate(-50%, -50%); }
.turn { width: 100%; height: 100%; will-change: transform; }
.turn svg { display: block; width: 100%; height: 100%; overflow: visible; }

/* Dark (before ignite): every line at 8 %, the mark and the detail out. */
:host([dark]) :is(.outer, .notches, .inner, .seg) { opacity: ${DIM}; }
:host([dark]) :is(.mark, .halo, .dial, .orbit, .script) { opacity: 0; }
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

/** A point on a circle of radius r, `deg` clockwise from 12 o'clock. */
function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

function arc(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The dial: 144 fine ticks just outside the ring, every sixth longer. */
function dial(collar: number): string {
  const ticks = Array.from({ length: 144 }, (_, i) => {
    const [x0, y0] = polar(collar + 5, i * 2.5);
    const [x1, y1] = polar(collar + (i % 6 === 0 ? 13 : 8), i * 2.5);
    return `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`;
  });
  return `<g class="dial">${ticks.join("")}</g>`;
}

/** A broken orbit ring: three arcs of light with hot cores, and a dotted run between them. Its layer turns very
 * slowly (an HTML layer, so the compositor turns it without repainting). */
function orbit(r: number, which: "out" | "in"): string {
  const arcs: [number, number][] = which === "out" ? [[8, 52], [130, 148], [214, 290]] : [[20, 70], [160, 178], [250, 320]];
  const lit = arcs.map(([a, b]) => `<path class="arc" d="${arc(r, a, b)}"/><path class="arc-hot" d="${arc(r, a + 2, b - 2)}"/>`).join("");
  const dotted = arcs.map(([, b], i) => `<path class="dash" d="${arc(r, b + 6, (arcs[i + 1]?.[0] ?? arcs[0]![0] + 360) - 6)}"/>`).join("");
  return `<g>${lit}${dotted}</g>`;
}

/** The printed ring inside the glass, round the mark. */
function script(r: number): string {
  const id = `core-script-${r}`;
  const words = "ETHEREUM · WORLD COMPUTER · SEPOLIA 11155111 · PROOF OF STAKE · ";
  return `<g class="script"><path id="${id}" fill="none" d="${arc(r, 200, 559.9)}"/><text><textPath href="#${id}" textLength="${(2 * Math.PI * r - 4).toFixed(1)}">${words}</textPath></text></g>`;
}

export class EgbCore extends HTMLElement {
  static readonly observedAttributes = ["glass", "collar"];
  readonly #core: HTMLElement;
  readonly #segs: SVGSVGElement;
  readonly #bloom: SVGSVGElement;
  readonly #detail: SVGSVGElement;
  readonly #orbits: readonly [SVGSVGElement, SVGSVGElement];
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
        <i class="ring halo"></i>
        <i class="ring disc"></i>
        <svg class="detail" aria-hidden="true"></svg>
        <div class="orbit out"><svg aria-hidden="true"></svg></div><div class="orbit in"><svg aria-hidden="true"></svg></div>
        <i class="ring swell"></i><i class="ring outer"></i><div class="notches">${notches}</div>
        <svg class="bloom" aria-hidden="true"></svg><svg class="segs" aria-hidden="true"></svg>
        <i class="ring inner"></i>
        <div class="mark"><div class="turn">${ethMarkSvg()}</div></div>
      </div>`,
    );
    this.#core = pick(root, ".core");
    this.#segs = pick<SVGSVGElement>(root, ".segs");
    this.#bloom = pick<SVGSVGElement>(root, ".bloom");
    this.#detail = pick<SVGSVGElement>(root, ".detail");
    this.#orbits = [pick<SVGSVGElement>(root, ".orbit.out svg"), pick<SVGSVGElement>(root, ".orbit.in svg")];
    this.#mark = pick(root, ".mark");
    this.#turn = pick(root, ".turn");
    this.#swell = pick(root, ".swell");
    this.#rings = [".outer", ".notches", ".inner"].map((s) => pick(root, s));
    this.#drawSegments(166, 132);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    const px = Number(value);
    const prop = name === "glass" ? "--g" : "--c";
    if (value !== null && px > 0) this.#core.style.setProperty(prop, `${px}px`);
    else this.#core.style.removeProperty(prop);
    const collar = Number(this.getAttribute("collar")) || 166;
    const glass = Number(this.getAttribute("glass")) || 132;
    if (px > 0) this.#drawSegments(collar, glass);
  }

  /** The segment ring at collar − 14, and its bloom on its own layer under it, in a box (collar + 24) × 2 round the centre; the
   * dial, the orbits and the printed ring round it. */
  #drawSegments(collar: number, glass: number): void {
    const half = collar + 24;
    const paths = segmentPaths(collar - 14);
    const box = `${-half} ${-half} ${half * 2} ${half * 2}`;
    this.#segs.setAttribute("viewBox", box);
    this.#bloom.setAttribute("viewBox", box);
    this.#bloom.innerHTML = paths.map((d) => `<path d="${d}" stroke-width="16" stroke-opacity="0.12"/><path d="${d}" stroke-width="10" stroke-opacity="0.22"/>`).join("");
    this.#segs.innerHTML = paths
      .map((d) => `<g class="seg"><path class="s-glow" d="${d}"/><path class="s-line" d="${d}"/><path class="s-hot" d="${d}"/></g>`)
      .join("");
    this.#detail.setAttribute("viewBox", box);
    this.#detail.innerHTML = `${dial(collar)}${script(glass - 22)}`;
    const [out, inner] = this.#orbits;
    for (const svg of this.#orbits) svg.setAttribute("viewBox", box);
    out.innerHTML = orbit(collar + 18, "out");
    inner.innerHTML = orbit(glass - 8, "in");
  }

  /** A copy of the outer ring swells out and fades; the segment ring blooms once. */
  swell(): void {
    if (this.hasAttribute("dark")) return;
    const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
    motion(this.#swell, [{ opacity: 0.9, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.18)" }], { duration: 700, easing: ease });
    motion(this.#bloom, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
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
    const details = [...this.#core.querySelectorAll(".halo, .dial, .orbit, .script")];
    this.#igniting = settled([
      ...segs.map((seg, i) => up(seg, i * 20, 90, DIM, SEG_OPACITY)),
      ...this.#rings.map((ring, i) => up(ring, ringsAt, 150, DIM, i === 2 ? 0.5 : 1)),
      up(this.#mark, ringsAt + 150, 300, 0, 1),
      ...details.map((d) => up(d, ringsAt + 150, 500, 0, Number(getComputedStyle(d).opacity) || 1)),
    ]).then(() => {
      this.#igniting = null;
    });
    return this.#igniting;
  }
}
