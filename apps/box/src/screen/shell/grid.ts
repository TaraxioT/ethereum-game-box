// The Grid: the static canvas the whole Box stands in, drawn once per layout and pixel size and cached. Back to
// front: the void, a faint square grid on the back wall, the horizon, the floor's perspective grid vanishing under
// the core, the core's soft reflection on the floor, and the traces as unpowered light lines with a lit terminal bar
// where each meets a part. All glow is baked here once (shadowBlur), so nothing on it costs a frame.
import type { Layout, Point } from "./layout.ts";
import { tracesFor, type Trace } from "./traces.ts";

const MAX_SIDE = 4096;
const KEEP = 2;
const cache = new Map<string, HTMLCanvasElement>();

/** The Grid's colours, as tokens.css has them (--void, --deep, --sys, --sys-hot): canvas needs the values. */
export const GRID = { void: "#010409", horizonVoid: "#020910", deep: "#061522", sys: "#cfe8f6", hot: "#ffffff" } as const;

/** An unpowered trace's intensity; a lit one is drawn at 1. */
export const UNPOWERED = 0.18;

/** A canvas's backing size for the stage at `scale` on this screen, at most 4096 px on a side. */
export function canvasSize(layout: Layout, scale: number, dpr: number): { w: number; h: number; ratio: number } {
  const want = Math.max(0.1, scale) * Math.max(1, dpr);
  const ratio = Math.min(want, MAX_SIDE / Math.max(layout.width, layout.height));
  return { w: Math.round(layout.width * ratio), h: Math.round(layout.height * ratio), ratio };
}

export function drawGrid(layout: Layout, scale: number): HTMLCanvasElement {
  const { w, h, ratio } = canvasSize(layout, scale, window.devicePixelRatio || 1);
  const key = `${layout.orientation}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (g) {
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint(g, layout, ratio);
  }
  cache.set(key, canvas);
  for (const old of cache.keys()) if (cache.size > KEEP) cache.delete(old);
  return canvas;
}

/** A `#rrggbb` colour at an alpha. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255} / ${a})`;
}

/** A polyline into a path, its 45° bends eased with a small radius. */
export function bend(path: Path2D, pts: readonly Point[], radius = 6): void {
  const first = pts[0];
  if (!first || pts.length < 2) return;
  path.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const room = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y)) / 2;
    path.arcTo(b.x, b.y, c.x, c.y, Math.min(radius, room));
  }
  const last = pts[pts.length - 1]!;
  path.lineTo(last.x, last.y);
}

/** The y of every floor line from the horizon toward the viewer, each gap 1.35 × the one before. */
export function floorLines(horizon: number, bottom: number, first = 4, growth = 1.35): number[] {
  const ys: number[] = [];
  let gap = first;
  for (let y = horizon + gap; y < bottom; y += gap, gap *= growth) ys.push(y);
  return ys;
}

// ---- layers ---------------------------------------------------------------------------------------------------------

function drawVoid(g: CanvasRenderingContext2D, l: Layout): void {
  const sky = g.createLinearGradient(0, 0, 0, l.horizon);
  sky.addColorStop(0, GRID.void);
  sky.addColorStop(1, GRID.horizonVoid);
  g.fillStyle = sky;
  g.fillRect(0, 0, l.width, l.horizon);
}

/** The back wall: a 64 px square grid, fading out over the top third of the stage. */
function drawWall(g: CanvasRenderingContext2D, l: Layout): void {
  const pitch = 64;
  const fade = g.createLinearGradient(0, 0, 0, l.height / 3);
  fade.addColorStop(0, alpha(GRID.sys, 0));
  fade.addColorStop(1, alpha(GRID.sys, 0.05));
  const p = new Path2D();
  const cx = l.core.centre.x;
  for (let x = cx - Math.ceil(cx / pitch) * pitch; x <= l.width; x += pitch) {
    p.moveTo(x + 0.5, 0);
    p.lineTo(x + 0.5, l.horizon);
  }
  for (let y = l.horizon - pitch; y >= 0; y -= pitch) {
    p.moveTo(0, y + 0.5);
    p.lineTo(l.width, y + 0.5);
  }
  g.strokeStyle = fade;
  g.lineWidth = 1;
  g.stroke(p);
}

/** The floor: a perspective grid below the horizon, vanishing under the core. */
function drawFloor(g: CanvasRenderingContext2D, l: Layout): void {
  const top = l.horizon;
  const fill = g.createLinearGradient(0, top, 0, l.height);
  fill.addColorStop(0, GRID.deep);
  fill.addColorStop(1, GRID.void);
  g.fillStyle = fill;
  g.fillRect(0, top, l.width, l.height - top);

  const vx = l.core.centre.x;
  const p = new Path2D();
  for (let i = 0; i <= 16; i++) {
    p.moveTo(vx, top);
    p.lineTo((l.width * i) / 16, l.height);
  }
  for (const y of floorLines(top, l.height)) {
    p.moveTo(0, y);
    p.lineTo(l.width, y);
  }
  const fade = g.createLinearGradient(0, top, 0, l.height);
  fade.addColorStop(0, alpha(GRID.sys, 0.1));
  fade.addColorStop(1, alpha(GRID.sys, 0.22));
  g.strokeStyle = fade;
  g.lineWidth = 1;
  g.stroke(p);
}

/** The horizon: one line across the whole stage, its bloom baked in. */
function drawHorizon(g: CanvasRenderingContext2D, l: Layout, ratio: number): void {
  g.save();
  g.shadowColor = "rgb(150 200 230 / 0.42)";
  g.shadowBlur = 20 * ratio;
  g.fillStyle = GRID.sys;
  g.fillRect(0, l.horizon - 0.5, l.width, 1);
  g.restore();
}

/** The core's reflection on the floor: a soft upright ellipse under it. */
function drawReflection(g: CanvasRenderingContext2D, l: Layout): void {
  const { centre, collar } = l.core;
  g.save();
  g.translate(centre.x, l.horizon + 60);
  g.scale(collar, 60);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  r.addColorStop(0, alpha(GRID.sys, 0.06));
  r.addColorStop(0.6, alpha(GRID.sys, 0.03));
  r.addColorStop(1, alpha(GRID.sys, 0));
  g.fillStyle = r;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * Traces as light lines, at an intensity: each a 2 px line in its colour round a 1 px hot core, with a baked bloom,
 * and a 2 × 8 px lit terminal bar across each end that meets a part (the core, and the port, clock or cartridge it
 * feeds). Exported for the packets canvas, which draws a lit trace the same way.
 */
export function drawTraces(g: CanvasRenderingContext2D, traces: readonly Trace[], intensity: number, ratio: number): void {
  const groups = new Map<string, Path2D>();
  for (const t of traces) {
    let p = groups.get(t.colour);
    if (!p) groups.set(t.colour, (p = new Path2D()));
    bend(p, t.points);
  }
  g.save();
  g.globalAlpha = intensity;
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const [colour, path] of groups) {
    g.shadowColor = alpha(colour, 0.6);
    g.shadowBlur = 8 * ratio;
    g.strokeStyle = colour;
    g.lineWidth = 2;
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = GRID.hot;
    g.lineWidth = 1;
    g.stroke(path);
  }
  // The terminals are lit whether or not the line is powered.
  g.globalAlpha = Math.max(intensity, 0.85);
  for (const t of traces) {
    const end = t.points.length - 1;
    terminal(g, t, t.points[end]!, t.points[end - 1] ?? t.points[end]!, ratio);
    if (t.plug) terminal(g, t, t.points[0]!, t.points[1] ?? t.points[0]!, ratio);
  }
  g.restore();
}

/** A 2 × 8 px bar across a trace's end, lit in its colour round a hot core. */
function terminal(g: CanvasRenderingContext2D, t: Trace, at: Point, from: Point, ratio: number): void {
  const a = Math.atan2(at.y - from.y, at.x - from.x);
  g.save();
  g.translate(at.x, at.y);
  g.rotate(a);
  g.shadowColor = alpha(t.colour, 0.7);
  g.shadowBlur = 6 * ratio;
  g.fillStyle = t.colour;
  g.fillRect(-1, -4, 2, 8);
  g.shadowBlur = 0;
  g.fillStyle = GRID.hot;
  g.fillRect(-0.5, -3, 1, 6);
  g.restore();
}

function paint(g: CanvasRenderingContext2D, l: Layout, ratio: number): void {
  drawVoid(g, l);
  drawWall(g, l);
  drawFloor(g, l);
  drawReflection(g, l);
  drawHorizon(g, l, ratio);
  drawTraces(g, tracesFor(l).all, UNPOWERED, ratio);
}
