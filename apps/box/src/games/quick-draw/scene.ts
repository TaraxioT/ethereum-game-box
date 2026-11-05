// The standoff's landscape at dusk, drawn once: a graded sky, a big low sun sitting on a long horizon, three layers of
// flat-topped mesas fading into the haze, a scrubby ground with a couple of saguaros, and dust low on the ground.
// Only the sun (the heartbeat) and a faint band of drifting motes move, and those on their own layers.
import { el } from "../../screen/shell/dom.ts";

export interface SceneSpec {
  readonly width: number;
  readonly height: number;
  /** The horizon's height on the stage. */
  readonly horizon: number;
  readonly sun: { readonly x: number; readonly y: number; readonly r: number };
}

export interface Scene {
  readonly el: HTMLElement;
  /** The sun's disc and halo, for the heartbeat. */
  readonly sun: HTMLElement;
}

const NS = "http://www.w3.org/2000/svg";

/** One flat-topped mesa: its centre and the half-widths of its top and foot (fractions of the width), its height. */
interface Mesa {
  readonly at: number;
  readonly top: number;
  readonly foot: number;
  readonly rise: number;
}

interface Range {
  readonly className: string;
  /** How far above the horizon this range stands. */
  readonly floor: number;
  readonly mesas: readonly Mesa[];
}

// Far to near. The middle stays low so the sun sits on the horizon between the figures.
const RANGES: readonly Range[] = [
  {
    className: "qd-range-far",
    floor: 6,
    mesas: [
      { at: 0.1, top: 0.07, foot: 0.13, rise: 118 },
      { at: 0.33, top: 0.035, foot: 0.07, rise: 64 },
      { at: 0.68, top: 0.03, foot: 0.06, rise: 52 },
      { at: 0.88, top: 0.08, foot: 0.13, rise: 136 },
    ],
  },
  {
    className: "qd-range-mid",
    floor: 3,
    mesas: [
      { at: 0.02, top: 0.06, foot: 0.11, rise: 84 },
      { at: 0.24, top: 0.025, foot: 0.06, rise: 38 },
      { at: 0.79, top: 0.05, foot: 0.1, rise: 70 },
    ],
  },
  {
    className: "qd-range-near",
    floor: 0,
    mesas: [
      { at: 0.06, top: 0.09, foot: 0.17, rise: 34 },
      { at: 0.95, top: 0.06, foot: 0.14, rise: 44 },
    ],
  },
];

/** A range's top edge from the left of the stage to the right: flat tops, a ledge partway down each side. */
function ridge(width: number, horizon: number, range: Range): string {
  const y0 = horizon - range.floor;
  const pts: string[] = [`0,${y0}`];
  for (const m of range.mesas) {
    const xFootL = (m.at - m.foot) * width;
    const xTopL = (m.at - m.top) * width;
    const xTopR = (m.at + m.top) * width;
    const xFootR = (m.at + m.foot) * width;
    const ledge = (m.foot - m.top) * width * 0.38;
    const top = y0 - m.rise;
    const shelf = y0 - m.rise * 0.52;
    pts.push(
      `${xFootL.toFixed(1)},${y0}`,
      `${(xTopL - ledge).toFixed(1)},${shelf.toFixed(1)}`,
      `${(xTopL - ledge * 0.55).toFixed(1)},${(shelf - 3).toFixed(1)}`,
      `${xTopL.toFixed(1)},${top}`,
      `${xTopR.toFixed(1)},${top}`,
      `${(xTopR + ledge * 0.55).toFixed(1)},${(shelf - 3).toFixed(1)}`,
      `${(xTopR + ledge).toFixed(1)},${shelf.toFixed(1)}`,
      `${xFootR.toFixed(1)},${y0}`,
    );
  }
  pts.push(`${width},${y0}`);
  return pts.join(" ");
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** A saguaro standing at (x, y), `h` tall: a trunk and two raised arms, drawn as round-capped strokes. */
function saguaro(x: number, y: number, h: number): SVGPathElement {
  const u = h / 100;
  const d = [
    `M${x} ${y} V${y - 100 * u}`,
    `M${x} ${y - 42 * u} H${x - 18 * u} V${y - 68 * u}`,
    `M${x} ${y - 58 * u} H${x + 16 * u} V${y - 84 * u}`,
  ].join(" ");
  return svgEl("path", { d, class: "qd-cactus", "stroke-width": (11 * u).toFixed(1) });
}

/** A low rock on the ground: a lumpy dome. */
function rock(x: number, y: number, w: number): SVGPathElement {
  const h = w * 0.42;
  const d = `M${x - w / 2} ${y} Q${x - w * 0.42} ${y - h} ${x - w * 0.05} ${y - h} Q${x + w * 0.4} ${y - h * 0.9} ${x + w / 2} ${y} Z`;
  return svgEl("path", { d, class: "qd-rock" });
}

function landscape(spec: SceneSpec): SVGSVGElement {
  const { width: w, height: h, horizon } = spec;
  const svg = svgEl("svg", { class: "qd-land", viewBox: `0 0 ${w} ${h}`, width: String(w), height: String(h), "aria-hidden": "true" });
  for (const range of RANGES) {
    const top = ridge(w, horizon, range);
    svg.append(
      svgEl("polygon", { points: `${top} ${w},${horizon + 2} 0,${horizon + 2}`, class: range.className }),
      // The sun is low and ahead: the ridge lines catch it in a thin lit edge.
      svgEl("polyline", { points: top, class: `qd-ridge-lit ${range.className}-lit` }),
    );
  }
  // The near ground: scrub, rocks and two cacti, sized by their distance below the horizon.
  const ground = h - horizon;
  const near = (f: number): number => horizon + ground * f;
  svg.append(
    svgEl("line", { x1: "0", y1: String(horizon + 0.5), x2: String(w), y2: String(horizon + 0.5), class: "qd-horizon" }),
    saguaro(w * 0.3, near(0.1), ground * 0.24),
    saguaro(w * 0.74, near(0.05), ground * 0.15),
    rock(w * 0.21, near(0.2), ground * 0.12),
    rock(w * 0.62, near(0.14), ground * 0.08),
    rock(w * 0.86, near(0.3), ground * 0.16),
    svgEl("path", {
      class: "qd-cracks",
      d: [
        `M${w * 0.38} ${near(0.62)} l${w * 0.05} ${-ground * 0.04} l${w * 0.04} ${ground * 0.02}`,
        `M${w * 0.55} ${near(0.78)} l${w * 0.06} ${ground * 0.03} l${w * 0.03} ${-ground * 0.05}`,
        `M${w * 0.12} ${near(0.5)} l${w * 0.05} ${ground * 0.02}`,
      ].join(" "),
    }),
  );
  return svg;
}

export function createScene(spec: SceneSpec): Scene {
  const root = el("div", "qd-scene");
  root.style.setProperty("--horizon", `${spec.horizon}px`);

  const sky = el("div", "qd-sky");

  const sun = el("div", "qd-sun");
  const d = spec.sun.r * 2;
  sun.style.left = `${spec.sun.x - spec.sun.r}px`;
  sun.style.top = `${spec.sun.y - spec.sun.r}px`;
  sun.style.width = `${d}px`;
  sun.style.height = `${d}px`;
  sun.append(el("span", "qd-sun-halo"), el("span", "qd-sun-disc"));

  const ground = el("div", "qd-ground");
  const dust = el("div", "qd-dust");
  const motes = el("div", "qd-motes");

  root.append(sky, sun, ground, landscape(spec), dust, motes);
  return { el: root, sun };
}
