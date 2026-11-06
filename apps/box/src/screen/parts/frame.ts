// The chamfered frame every lit part is drawn in. Chamfered shapes can't carry a box-shadow (clip-path clips it), so
// the frame is inline SVG, split over two layers so a part can light its bloom on its own. `.frame-bloom` holds the
// wide soft strokes (12 px at 0.1, 5 px at 0.22); `.frame-line` the 2 px line in the frame's tone over a 1 px hot core,
// the two cut edges lit brighter (a bevel catching the light), a faint 1 px inner line 5 px inside (the panel's
// thickness), and (for panels) a tick on each uncut corner. A part sets each layer's opacity for its state; only
// opacity ever animates. Fills go on a plain element clipped with `chamferClip` (tokens.css's `--glass`).
//
// The tone is `--frame-tone` where a part sets it (a seat's colour, the alert red), else the option's default. The
// system's white light blooms blue (`--sys-glow`); a set tone blooms in itself.

export type Corners = "tl-br" | "tr-bl";

export interface FrameOptions {
  /** The cut, in px. */
  readonly chamfer: number;
  /** Which two corners are cut (default top left and bottom right). */
  readonly corners?: Corners;
  /** The line's colour where `--frame-tone` isn't set (default the system's light). */
  readonly tone?: string;
  /** A 10 px hot tick on each uncut corner (panels). */
  readonly ticks?: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
/** The polygon sits 1 px in, so the 2 px line lies inside the box. */
const IN = 1;
const TICK = 10;
/** The inner line's distance inside the frame. */
const BEVEL = 5;

/** The frame's polygon for a w × h box, `inset` px in from its edge (the frame itself sits 1 px in). A chamfer moved
 * in keeps its 45° cut parallel to the outer one. */
export function framePoints(w: number, h: number, chamfer: number, corners: Corners = "tl-br", inset = IN): string {
  return outline(w, h, chamfer, corners, inset)
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(" ");
}

function outline(w: number, h: number, chamfer: number, corners: Corners, inset: number): [number, number][] {
  const c = Math.max(0, Math.min(chamfer, w / 2, h / 2) - (inset - IN) * (2 - Math.SQRT2));
  const [l, t, r, b] = [inset, inset, w - inset, h - inset];
  return corners === "tl-br"
    ? [[l + c, t], [r, t], [r, b - c], [r - c, b], [l, b], [l, t + c]]
    : [[l, t], [r - c, t], [r, t + c], [r, b], [l + c, b], [l, b - c]];
}

/** The two cut edges, as path data. */
export function bevelPath(w: number, h: number, chamfer: number, corners: Corners = "tl-br"): string {
  const p = outline(w, h, chamfer, corners, IN);
  const seg = (a: number, b: number): string => `M${round(p[a]![0])} ${round(p[a]![1])}L${round(p[b]![0])} ${round(p[b]![1])}`;
  return corners === "tl-br" ? seg(5, 0) + seg(2, 3) : seg(1, 2) + seg(4, 5);
}

/** The ticks on the two uncut corners, as path data. */
export function tickPath(w: number, h: number, corners: Corners = "tl-br"): string {
  const [l, t, r, b] = [IN, IN, w - IN, h - IN];
  return corners === "tl-br"
    ? `M${round(r - TICK)} ${t}H${round(r)}V${t + TICK}M${l} ${round(b - TICK)}V${round(b)}H${l + TICK}`
    : `M${l + TICK} ${t}H${l}V${t + TICK}M${round(r)} ${round(b - TICK)}V${round(b)}H${round(r - TICK)}`;
}

/** A CSS clip-path for a fill under a frame, for any box size. */
export function chamferClip(chamfer: number, corners: Corners = "tl-br"): string {
  const c = `${chamfer}px`;
  return corners === "tl-br"
    ? `polygon(${c} 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%, 0 ${c})`
    : `polygon(0 0, calc(100% - ${c}) 0, 100% ${c}, 100% 100%, ${c} 100%, 0 calc(100% - ${c}))`;
}

const round = (n: number): number => Math.round(n * 10) / 10;

export interface Frame {
  readonly bloom: SVGSVGElement;
  readonly line: SVGSVGElement;
  /** Redraws the frame for a w × h box. */
  size(w: number, h: number): void;
}

/** The frame's two layers, drawn for a w × h box. */
export function frameSvg(options: FrameOptions & { readonly w: number; readonly h: number }): Frame {
  const corners = options.corners ?? "tl-br";
  const tone = `var(--frame-tone, ${options.tone ?? "var(--sys)"})`;
  const glow = `var(--frame-tone, ${options.tone ?? "var(--sys-glow)"})`;
  const layer = (name: string): SVGSVGElement => {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", name);
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;";
    return svg;
  };
  const poly = (stroke: string, width: number, opacity: number): SVGPolygonElement => {
    const p = document.createElementNS(SVG, "polygon");
    p.setAttribute("fill", "none");
    p.setAttribute("stroke-width", String(width));
    p.setAttribute("stroke-linejoin", "miter");
    p.setAttribute("stroke-opacity", String(opacity));
    p.style.stroke = stroke;
    return p;
  };
  const bloom = layer("frame-bloom");
  const line = layer("frame-line");
  const polys = [poly(glow, 12, 0.1), poly(glow, 5, 0.22)];
  bloom.append(...polys);
  const inner = poly(tone, 1, 0.22);
  const lines = [poly(tone, 2, 1), poly("var(--sys-hot)", 1, 1)];
  const bevel = document.createElementNS(SVG, "path");
  bevel.setAttribute("fill", "none");
  bevel.setAttribute("stroke-width", "3.5");
  bevel.setAttribute("stroke-linecap", "square");
  bevel.style.stroke = "var(--sys-hot)";
  line.append(inner, ...lines, bevel);
  const tick = options.ticks ? document.createElementNS(SVG, "path") : null;
  if (tick) {
    tick.setAttribute("fill", "none");
    tick.setAttribute("stroke-width", "2");
    tick.style.stroke = "var(--sys-hot)";
    line.append(tick);
  }
  const frame: Frame = {
    bloom,
    line,
    size(w, h) {
      if (w <= 0 || h <= 0) return;
      const pts = framePoints(w, h, options.chamfer, corners);
      for (const p of [...polys, ...lines]) p.setAttribute("points", pts);
      inner.setAttribute("points", framePoints(w, h, options.chamfer, corners, BEVEL));
      bevel.setAttribute("d", bevelPath(w, h, options.chamfer, corners));
      tick?.setAttribute("d", tickPath(w, h, corners));
    },
  };
  frame.size(options.w, options.h);
  return frame;
}

/** A frame laid in `box` (over its `.frame-fill`, if it has one, and under the rest) and kept to its size. */
export function fitFrame(box: HTMLElement, options: FrameOptions): Frame {
  const frame = frameSvg({ ...options, w: box.clientWidth, h: box.clientHeight });
  const fill = box.querySelector(":scope > .frame-fill");
  if (fill) fill.after(frame.bloom, frame.line);
  else box.prepend(frame.bloom, frame.line);
  new ResizeObserver(([entry]) => {
    const r = entry?.contentBoxSize[0];
    if (r) frame.size(box.clientWidth || r.inlineSize, box.clientHeight || r.blockSize);
  }).observe(box);
  return frame;
}

/** Makes `node` a chamfered box: a dark `.frame-fill` cut to the shape under its content, then a frame of light kept to
 * its size. The fill's colour is the caller's CSS (`--glass`). */
export function framed<T extends HTMLElement>(node: T, chamfer: number): T {
  const fill = document.createElement("i");
  fill.className = "frame-fill";
  fill.style.clipPath = chamferClip(chamfer);
  node.prepend(fill);
  fitFrame(node, { chamfer, ticks: true });
  return node;
}
