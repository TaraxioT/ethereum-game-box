// The Grid: the static canvas the whole Box stands in, drawn once per layout and pixel size and cached. Back to
// front: a storm-dark sky lit from the horizon, faint cloud banks, two ranges of distant ridges with lit crests and a
// far city of towers off to one side; the glossy floor, its perspective grid fading into haze at the horizon, the
// streaks of light the core and the city cast on it and pools under the rack; the horizon with a hot vanishing point;
// the traces as unpowered light lines sunk in dark channels, with lit terminal bars; and over it all the HUD's
// corner brackets and edge rulers, a vignette and a fine grain. All glow is baked here once (shadowBlur), so nothing
// on it costs a frame.
import type { Layout, Point } from "./layout.ts";
import { tracesFor, type Trace } from "./traces.ts";

const MAX_SIDE = 4096;
const KEEP = 2;
const cache = new Map<string, HTMLCanvasElement>();

/** The Grid's colours. Canvas needs the values: void, sys, glow and hot are tokens.css's --void, --sys, --sys-glow
 * and --sys-hot; haze is the blue lying in the air at the horizon, the Grid's own. */
export const GRID = {
  void: "#010409",
  haze: "#0c2c44",
  sys: "#cfe8f6",
  glow: "#4aa8e8",
  hot: "#ffffff",
} as const;

/** An unpowered trace's intensity; a lit one is drawn at 1. */
export const UNPOWERED = 0.2;

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

/** The colour a line's bloom takes: the system's white light blooms blue; a seat's light blooms in its own colour. */
export function glowOf(colour: string): string {
  return colour === GRID.sys || colour === GRID.hot ? GRID.glow : colour;
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

/** A small seeded generator, so the Grid's scenery is the same on every Box and every redraw. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A ridgeline across the stage: angular peaks between `low` and `high` px above the horizon, steeper than 45° up
 * and down, from just off the left edge to just off the right.
 */
export function ridge(width: number, horizon: number, low: number, high: number, seed: number): Point[] {
  const rnd = seeded(seed);
  const pts: Point[] = [{ x: -20, y: horizon - low }];
  let x = -20;
  while (x < width + 20) {
    x += 24 + rnd() * 56;
    pts.push({ x, y: horizon - (low + (high - low) * rnd() ** 1.6) });
  }
  return pts;
}

// ---- layers ---------------------------------------------------------------------------------------------------------

/** The sky: storm-dark at the top, lifting to a hazy blue at the horizon, the light rising from the vanishing point. */
function drawSky(g: CanvasRenderingContext2D, l: Layout): void {
  const sky = g.createLinearGradient(0, 0, 0, l.horizon);
  sky.addColorStop(0, GRID.void);
  sky.addColorStop(0.55, "#020a14");
  sky.addColorStop(0.85, "#061a2a");
  sky.addColorStop(1, "#0b2a40");
  g.fillStyle = sky;
  g.fillRect(0, 0, l.width, l.horizon);
  glowEllipse(g, l.core.centre.x, l.horizon, l.width * 0.62, l.horizon * 0.42, alpha(GRID.glow, 0.22));
  glowEllipse(g, l.core.centre.x, l.horizon, l.width * 0.22, 46, alpha("#9fd6ff", 0.22));
}

/** Cloud banks: long, flat, barely lit shapes in the upper sky and lower ones lit from beneath by the horizon. */
function drawClouds(g: CanvasRenderingContext2D, l: Layout): void {
  const rnd = seeded(7);
  for (let i = 0; i < 22; i++) {
    const y = l.horizon * (0.08 + 0.78 * rnd());
    const near = y / l.horizon;
    const rx = 120 + rnd() * 320;
    glowEllipse(g, rnd() * l.width, y, rx, 6 + rnd() * 18, alpha("#6aa6cf", 0.025 + 0.05 * near * near));
  }
  // A few thin bright cloud edges near the horizon, the light catching their undersides.
  for (let i = 0; i < 7; i++) {
    const y = l.horizon - 70 - rnd() * 110;
    glowEllipse(g, rnd() * l.width, y, 90 + rnd() * 200, 2 + rnd() * 2, alpha("#a8d8ff", 0.06));
  }
}

/** Two ranges of distant ridges, the far one paler in the haze; each crest is a thin lit line. */
function drawRidges(g: CanvasRenderingContext2D, l: Layout): void {
  const ranges = [
    { low: 18, high: 96, seed: 3, fill: "#04121e", crest: 0.16 },
    { low: 6, high: 58, seed: 11, fill: "#020a12", crest: 0.26 },
  ];
  for (const r of ranges) {
    const pts = ridge(l.width, l.horizon, r.low, r.high, r.seed);
    const crest = new Path2D();
    crest.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) crest.lineTo(p.x, p.y);
    const body = new Path2D(crest);
    body.lineTo(l.width + 20, l.horizon);
    body.lineTo(-20, l.horizon);
    body.closePath();
    const fill = g.createLinearGradient(0, l.horizon - r.high, 0, l.horizon);
    fill.addColorStop(0, r.fill);
    fill.addColorStop(1, alpha(GRID.haze, 0.9));
    g.fillStyle = fill;
    g.fill(body);
    g.save();
    g.lineJoin = "miter";
    g.strokeStyle = alpha(GRID.sys, r.crest);
    g.lineWidth = 1;
    g.stroke(crest);
    g.restore();
  }
}

/** Where the far city stands: a band off to the side of the core, clear of the title and the keys. */
function cityBand(l: Layout): { from: number; to: number; tall: number } {
  return l.orientation === "portrait"
    ? { from: l.width * 0.68, to: l.width * 0.96, tall: 96 }
    : { from: l.width * 0.7, to: l.width * 0.95, tall: 150 };
}

/** The far city: dark towers standing on the horizon, their edges and a few floors lit, a beacon on the tallest. */
function drawCity(g: CanvasRenderingContext2D, l: Layout, ratio: number): Point[] {
  const rnd = seeded(23);
  const band = cityBand(l);
  const mid = (band.from + band.to) / 2;
  const tops: Point[] = [];
  let x = band.from;
  while (x < band.to) {
    const w = 6 + rnd() * 16;
    const fromMid = 1 - Math.abs(x - mid) / ((band.to - band.from) / 2);
    const h = 12 + band.tall * (0.25 + 0.75 * rnd()) * Math.max(0.15, fromMid) ** 0.8;
    const top = l.horizon - h;
    const body = g.createLinearGradient(0, top, 0, l.horizon);
    body.addColorStop(0, "#03101a");
    body.addColorStop(1, alpha(GRID.haze, 0.95));
    g.fillStyle = body;
    g.fillRect(x, top, w, h);
    g.fillStyle = alpha(GRID.sys, 0.22);
    g.fillRect(x, top, 1, h);
    g.fillStyle = alpha(GRID.sys, 0.1);
    g.fillRect(x + w - 1, top, 1, h);
    // Lit floors: short hot dashes at random heights.
    for (let f = top + 4; f < l.horizon - 3; f += 3 + rnd() * 9) {
      if (rnd() < 0.35) {
        g.fillStyle = alpha(rnd() < 0.85 ? "#bfe6ff" : "#ffb070", 0.18 + rnd() * 0.3);
        g.fillRect(x + 2, f, Math.max(1, (w - 4) * (0.3 + rnd() * 0.7)), 1);
      }
    }
    tops.push({ x: x + w / 2, y: top });
    x += w + 1 + rnd() * 5;
  }
  // A beacon on the tallest tower.
  const tallest = tops.reduce((a, b) => (b.y < a.y ? b : a), tops[0] ?? { x: mid, y: l.horizon });
  g.save();
  g.shadowColor = GRID.glow;
  g.shadowBlur = 10 * ratio;
  g.fillStyle = GRID.hot;
  g.fillRect(tallest.x - 0.5, tallest.y - 14, 1, 14);
  g.fillRect(tallest.x - 1.5, tallest.y - 15, 3, 2);
  g.restore();
  return tops;
}

/** The floor: glossy black, lit hazy blue at the horizon, darkening toward the viewer. */
function drawFloor(g: CanvasRenderingContext2D, l: Layout): void {
  const top = l.horizon;
  const fill = g.createLinearGradient(0, top, 0, l.height);
  fill.addColorStop(0, "#0a2436");
  fill.addColorStop(0.18, "#04121e");
  fill.addColorStop(0.6, "#020810");
  fill.addColorStop(1, GRID.void);
  g.fillStyle = fill;
  g.fillRect(0, top, l.width, l.height - top);
  // The horizon's light mirrored in the gloss.
  glowEllipse(g, l.core.centre.x, top, l.width * 0.5, (l.height - top) * 0.55, alpha(GRID.glow, 0.12));
}

/** The floor's perspective grid: every fourth line a major one with its bloom, all of it fading into the haze. */
function drawFloorGrid(g: CanvasRenderingContext2D, l: Layout, ratio: number): void {
  const top = l.horizon;
  const vx = l.core.centre.x;
  const minor = new Path2D();
  const major = new Path2D();
  const rays = 32;
  for (let i = -8; i <= rays + 8; i++) {
    const p = i % 4 === 0 ? major : minor;
    p.moveTo(vx, top);
    p.lineTo(vx + (((l.width * i) / rays - vx) * 1.4), l.height);
  }
  floorLines(top, l.height, 3, 1.28).forEach((y, i) => {
    const p = i % 3 === 2 ? major : minor;
    p.moveTo(0, y);
    p.lineTo(l.width, y);
  });
  const fade = (a: number): CanvasGradient => {
    const f = g.createLinearGradient(0, top, 0, l.height);
    f.addColorStop(0, alpha(GRID.sys, 0));
    f.addColorStop(0.12, alpha(GRID.sys, a * 0.45));
    f.addColorStop(1, alpha(GRID.sys, a));
    return f;
  };
  g.save();
  g.lineWidth = 1;
  g.strokeStyle = fade(0.13);
  g.stroke(minor);
  g.shadowColor = alpha(GRID.glow, 0.9);
  g.shadowBlur = 6 * ratio;
  g.lineWidth = 1.25;
  g.strokeStyle = fade(0.38);
  g.stroke(major);
  g.restore();
  // Haze lying on the floor at the horizon, over the far lines.
  const haze = g.createLinearGradient(0, top, 0, top + 70);
  haze.addColorStop(0, alpha(GRID.haze, 0.85));
  haze.addColorStop(1, alpha(GRID.haze, 0));
  g.fillStyle = haze;
  g.fillRect(0, top, l.width, 70);
}

/** Light cast on the gloss: a long soft streak under the core, thinner ones under the city's towers, a pool under
 * each rack slot. */
function drawReflections(g: CanvasRenderingContext2D, l: Layout, city: readonly Point[]): void {
  const top = l.horizon;
  const { centre, collar } = l.core;
  streak(g, centre.x, top, collar * 0.9, l.height - top, alpha(GRID.glow, 0.16));
  streak(g, centre.x, top, collar * 0.22, (l.height - top) * 0.8, alpha("#d8f0ff", 0.12));
  const rnd = seeded(41);
  for (const t of city) if (rnd() < 0.5) streak(g, t.x, top, 2 + rnd() * 3, 40 + rnd() * 90, alpha("#bfe6ff", 0.08 + rnd() * 0.08));
  for (const r of l.rack) glowEllipse(g, r.x + r.w / 2, r.y + r.h + 6, r.w * 0.62, 16, alpha(GRID.glow, 0.16));
}

/** The horizon: one line across the stage, brightest at the vanishing point, with a hot flare there. */
function drawHorizon(g: CanvasRenderingContext2D, l: Layout, ratio: number): void {
  const cx = l.core.centre.x;
  const line = g.createLinearGradient(0, 0, l.width, 0);
  line.addColorStop(0, alpha(GRID.sys, 0.35));
  line.addColorStop(cx / l.width, GRID.hot);
  line.addColorStop(1, alpha(GRID.sys, 0.35));
  g.save();
  g.shadowColor = GRID.glow;
  g.shadowBlur = 16 * ratio;
  g.fillStyle = line;
  g.fillRect(0, l.horizon - 0.75, l.width, 1.5);
  g.restore();
  // The flare: a long thin anamorphic streak and a small hot bloom at the vanishing point.
  glowEllipse(g, cx, l.horizon, l.width * 0.42, 3, alpha("#bfe6ff", 0.55));
  glowEllipse(g, cx, l.horizon, 70, 10, alpha("#e6f6ff", 0.4));
}

/** The channels the traces run in: a dark groove with faint lit lips, so the lines sit in the surface. */
function drawChannels(g: CanvasRenderingContext2D, traces: readonly Trace[]): void {
  const all = new Path2D();
  for (const t of traces) bend(all, t.points);
  g.save();
  g.lineJoin = "round";
  g.lineCap = "butt";
  g.strokeStyle = alpha(GRID.sys, 0.07);
  g.lineWidth = 9;
  g.stroke(all);
  g.strokeStyle = "rgb(0 2 6 / 0.92)";
  g.lineWidth = 7;
  g.stroke(all);
  g.restore();
}

/**
 * Traces as light lines, at an intensity: each a 2 px line in its colour round a 1 px hot core, with a baked bloom
 * (the system's light blooms blue), and a 2 × 8 px lit terminal bar across each end that meets a part (the core, and
 * the port, clock or cartridge it feeds). Exported for the packets canvas, which draws a lit trace the same way.
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
    g.shadowColor = alpha(glowOf(colour), 0.85);
    g.shadowBlur = 10 * ratio;
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
  g.shadowColor = alpha(glowOf(t.colour), 0.9);
  g.shadowBlur = 8 * ratio;
  g.fillStyle = t.colour;
  g.fillRect(-1, -4, 2, 8);
  g.shadowBlur = 0;
  g.fillStyle = GRID.hot;
  g.fillRect(-0.5, -3, 1, 6);
  g.restore();
}

/** The HUD's frame on the stage: a bracket in each corner and a short ruler down each side. */
function drawHud(g: CanvasRenderingContext2D, l: Layout): void {
  const inset = 12;
  const arm = 34;
  const p = new Path2D();
  const corner = (x: number, y: number, dx: number, dy: number): void => {
    p.moveTo(x + dx * arm, y);
    p.lineTo(x + dx * 6, y);
    p.lineTo(x, y + dy * 6);
    p.lineTo(x, y + dy * arm);
  };
  corner(inset, inset, 1, 1);
  corner(l.width - inset, inset, -1, 1);
  corner(inset, l.height - inset, 1, -1);
  corner(l.width - inset, l.height - inset, -1, -1);
  g.save();
  g.strokeStyle = alpha(GRID.sys, 0.4);
  g.lineWidth = 1.5;
  g.stroke(p);
  // Rulers: a tick every 8 px down the middle of each side, every fifth long, round a small hot mark.
  const mid = l.horizon - (l.orientation === "portrait" ? 300 : 150);
  const ticks = new Path2D();
  for (let i = -10; i <= 10; i++) {
    const len = i % 5 === 0 ? 10 : 5;
    const y = mid + i * 8;
    ticks.moveTo(inset, y);
    ticks.lineTo(inset + len, y);
    ticks.moveTo(l.width - inset, y);
    ticks.lineTo(l.width - inset - len, y);
  }
  g.strokeStyle = alpha(GRID.sys, 0.22);
  g.lineWidth = 1;
  g.stroke(ticks);
  g.fillStyle = alpha(GRID.sys, 0.8);
  g.fillRect(inset, mid - 1, 14, 2);
  g.fillRect(l.width - inset - 14, mid - 1, 14, 2);
  g.restore();
}

/** The vignette: the stage's edges fall away into the dark. */
function drawVignette(g: CanvasRenderingContext2D, l: Layout): void {
  const r = Math.hypot(l.width, l.height) / 2;
  const v = g.createRadialGradient(l.width / 2, l.height * 0.45, r * 0.45, l.width / 2, l.height * 0.45, r);
  v.addColorStop(0, "rgb(0 0 0 / 0)");
  v.addColorStop(1, "rgb(0 0 0 / 0.6)");
  g.fillStyle = v;
  g.fillRect(0, 0, l.width, l.height);
}

/** A fine static grain, so the dark reads as a surface rather than flat black. */
function drawGrain(g: CanvasRenderingContext2D, l: Layout): void {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const t = tile.getContext("2d");
  if (!t) return;
  const img = t.createImageData(128, 128);
  const rnd = seeded(97);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 140 + rnd() * 115;
    img.data[i] = v * 0.8;
    img.data[i + 1] = v * 0.92;
    img.data[i + 2] = v;
    img.data[i + 3] = rnd() * 14;
  }
  t.putImageData(img, 0, 0);
  const pattern = g.createPattern(tile, "repeat");
  if (!pattern) return;
  g.fillStyle = pattern;
  g.fillRect(0, 0, l.width, l.height);
}

/** A soft elliptical glow, from its colour at the centre to nothing at its edge. */
function glowEllipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, colour: string): void {
  g.save();
  g.translate(x, y);
  g.scale(rx, ry);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  r.addColorStop(0, colour);
  r.addColorStop(1, "rgb(0 0 0 / 0)");
  g.fillStyle = r;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A light's reflection in the gloss: a soft vertical streak down from `y`, fading along and across. */
function streak(g: CanvasRenderingContext2D, x: number, y: number, halfWidth: number, length: number, colour: string): void {
  g.save();
  g.translate(x, y);
  g.scale(halfWidth, length);
  const across = g.createLinearGradient(-1, 0, 1, 0);
  across.addColorStop(0, "rgb(0 0 0 / 0)");
  across.addColorStop(0.5, colour);
  across.addColorStop(1, "rgb(0 0 0 / 0)");
  g.fillStyle = across;
  // Fade along it by drawing it in thin bands that thin out with distance.
  const bands = 24;
  for (let i = 0; i < bands; i++) {
    g.globalAlpha = (1 - i / bands) ** 1.8;
    g.fillRect(-1, i / bands, 2, 1 / bands + 0.002);
  }
  g.restore();
}

function paint(g: CanvasRenderingContext2D, l: Layout, ratio: number): void {
  const traces = tracesFor(l).all;
  drawSky(g, l);
  drawClouds(g, l);
  drawRidges(g, l);
  const city = drawCity(g, l, ratio);
  drawFloor(g, l);
  drawFloorGrid(g, l, ratio);
  drawReflections(g, l, city);
  drawHorizon(g, l, ratio);
  drawChannels(g, traces);
  drawTraces(g, traces, UNPOWERED, ratio);
  drawHud(g, l);
  drawVignette(g, l);
  drawGrain(g, l);
}
