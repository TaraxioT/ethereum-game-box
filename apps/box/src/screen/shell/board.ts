// The board: the static canvas the whole Box stands on, drawn once per layout and pixel size and cached. Lit from
// the top left: the room's deep groove, gunmetal plates with bevelled seams and screws, small 3D parts and unlit
// copper scattered (seeded, so the same every load) in the free board, and the neon traces with their connectors and
// the collar's landing pads. Callers put the canvas behind the stage at the stage's own size (stage pixels).
import type { Layout, Point, Rect } from "./layout.ts";
import { inflate, rectsOverlap } from "./route.ts";
import { mulberry32 } from "@egb/sdk";
import { tracesFor, type Trace } from "./traces.ts";

const MAX_SIDE = 4096;
const KEEP = 2;
const cache = new Map<string, HTMLCanvasElement>();

/** A canvas's backing size for the stage at `scale` on this screen, at most 4096 px on a side. */
export function canvasSize(layout: Layout, scale: number, dpr: number): { w: number; h: number; ratio: number } {
  const want = Math.max(0.1, scale) * Math.max(1, dpr);
  const ratio = Math.min(want, MAX_SIDE / Math.max(layout.width, layout.height));
  return { w: Math.round(layout.width * ratio), h: Math.round(layout.height * ratio), ratio };
}

export function drawBoard(layout: Layout, scale: number): HTMLCanvasElement {
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
    paint(g, layout);
  }
  cache.set(key, canvas);
  for (const old of cache.keys()) if (cache.size > KEEP) cache.delete(old);
  return canvas;
}

// ---- colour ---------------------------------------------------------------------------------------------------------

const ROOM = "#120c24";
const PLATE_HI = "#2d2356";
const PLATE_LO = "#211943";
const INK = "#07040f";

/** A `#rrggbb` colour's channels; anything else reads as white. */
function rgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [255, 255, 255];
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** A colour moved toward white (k > 0) or black (k < 0). */
function tint(hex: string, k: number): string {
  const [r, g, b] = rgb(hex).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))) as [number, number, number];
  return `rgb(${r} ${g} ${b})`;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

// ---- the plates -----------------------------------------------------------------------------------------------------

interface Plate {
  readonly r: Rect;
  /** Chamfers: top left, top right, bottom right, bottom left. */
  readonly c: readonly [number, number, number, number];
  /** A little lighter or darker than its neighbours, so the plates read as separate pieces. */
  readonly tone: number;
}

const SEAM = 6;

/** The plates for a layout, their seams laid in the free board between what is read. */
function platesFor(l: Layout): Plate[] {
  const W = l.width;
  const H = l.height;
  const portsBottom = Math.max(...l.ports.map((p) => p.module.y + p.module.h));
  const rackTop = Math.min(...l.rack.map((r) => r.y));
  const g = l.gauge;
  if (l.orientation === "landscape") {
    const top = portsBottom + 42;
    const colL = l.title.x + l.title.w + SEAM;
    const colR = W - colL;
    const midBottom = rackTop - 72;
    const bx = colL + SEAM;
    const bw = g.centre.x + g.radius + 20 - bx;
    const bh = l.txbar.y + l.txbar.h + 12;
    const cx = bx + bw + SEAM;
    return [
      { r: { x: 0, y: 0, w: colL, h: top }, c: [0, 0, 24, 0], tone: 0.03 },
      { r: { x: bx, y: 0, w: bw, h: bh }, c: [0, 0, 26, 26], tone: -0.02 },
      { r: { x: cx, y: 0, w: W - cx, h: top }, c: [0, 0, 0, 24], tone: 0.03 },
      { r: { x: 0, y: top + SEAM, w: colL, h: midBottom - top - SEAM }, c: [0, 30, 30, 0], tone: -0.03 },
      { r: { x: bx, y: bh + SEAM, w: colR - bx - SEAM, h: midBottom - bh - SEAM }, c: [18, 18, 0, 0], tone: 0 },
      { r: { x: colR, y: top + SEAM, w: W - colR, h: midBottom - top - SEAM }, c: [30, 0, 0, 30], tone: -0.03 },
      { r: { x: 0, y: midBottom + SEAM, w: W, h: H - midBottom - SEAM }, c: [0, 0, 0, 0], tone: -0.09 },
    ];
  }
  const top = portsBottom + 20;
  const half = W / 2;
  const midTop = top + SEAM;
  const midBottom = l.title.y - 16;
  const colL = l.clock.x - 10;
  const colR = g.centre.x + g.radius + 8 + SEAM;
  const lowTop = midBottom + SEAM;
  const rackPlate = rackTop - 12;
  return [
    { r: { x: 0, y: 0, w: half - SEAM / 2, h: top }, c: [0, 0, 20, 0], tone: 0.03 },
    { r: { x: half + SEAM / 2, y: 0, w: half - SEAM / 2, h: top }, c: [0, 0, 0, 20], tone: 0.03 },
    { r: { x: 0, y: midTop, w: colL, h: midBottom - midTop }, c: [0, 22, 22, 0], tone: -0.03 },
    { r: { x: colL + SEAM, y: midTop, w: colR - colL - SEAM * 2, h: midBottom - midTop }, c: [16, 16, 16, 16], tone: 0 },
    { r: { x: colR, y: midTop, w: W - colR, h: midBottom - midTop }, c: [22, 0, 0, 22], tone: -0.03 },
    { r: { x: 0, y: lowTop, w: W, h: rackPlate - SEAM - lowTop }, c: [0, 0, 0, 0], tone: -0.04 },
    { r: { x: 0, y: rackPlate, w: W, h: H - rackPlate }, c: [0, 0, 0, 0], tone: -0.09 },
  ];
}

function platePath(p: Plate): Path2D {
  const [tl, tr, br, bl] = p.c;
  const { x, y, w, h } = p.r;
  const q = new Path2D();
  q.moveTo(x + tl, y);
  q.lineTo(x + w - tr, y);
  q.lineTo(x + w, y + tr);
  q.lineTo(x + w, y + h - br);
  q.lineTo(x + w - br, y + h);
  q.lineTo(x + bl, y + h);
  q.lineTo(x, y + h - bl);
  q.lineTo(x, y + tl);
  q.closePath();
  return q;
}

/** The room's ground: the deep groove between plates, a faint grid of drill marks across it. */
function drawGround(g: CanvasRenderingContext2D, l: Layout): void {
  g.fillStyle = ROOM;
  g.fillRect(0, 0, l.width, l.height);
  const tile = document.createElement("canvas");
  tile.width = tile.height = 12;
  const t = tile.getContext("2d");
  if (!t) return;
  t.fillStyle = "rgb(150 130 220 / 0.09)";
  t.fillRect(5, 5, 1.5, 1.5);
  t.fillStyle = "rgb(0 0 0 / 0.25)";
  t.fillRect(0, 11, 12, 1);
  const pattern = g.createPattern(tile, "repeat");
  if (!pattern) return;
  g.fillStyle = pattern;
  g.fillRect(0, 0, l.width, l.height);
}

/** Each plate casts into the groove, carries a top-to-bottom face, a lit top-left bevel and a dark bottom-right one. */
function drawPlates(g: CanvasRenderingContext2D, plates: readonly Plate[]): void {
  for (const p of plates) {
    const path = platePath(p);
    const face = g.createLinearGradient(0, p.r.y, 0, p.r.y + p.r.h);
    face.addColorStop(0, tint(PLATE_HI, p.tone));
    face.addColorStop(1, tint(PLATE_LO, p.tone));
    g.save();
    g.shadowColor = "rgb(3 1 10 / 0.85)";
    g.shadowBlur = 6;
    g.shadowOffsetX = 1;
    g.shadowOffsetY = 3;
    g.fillStyle = face;
    g.fill(path);
    g.restore();

    g.save();
    g.clip(path);
    // The key light's sheen across the plate from its top-left corner.
    const sheen = g.createRadialGradient(p.r.x, p.r.y, 0, p.r.x, p.r.y, Math.max(p.r.w, p.r.h) * 0.9);
    sheen.addColorStop(0, "rgb(200 180 255 / 0.07)");
    sheen.addColorStop(1, "rgb(200 180 255 / 0)");
    g.fillStyle = sheen;
    g.fillRect(p.r.x, p.r.y, p.r.w, p.r.h);
    g.lineJoin = "miter";
    g.translate(1.4, 1.4);
    g.strokeStyle = "rgb(205 188 255 / 0.36)";
    g.lineWidth = 2.6;
    g.stroke(path);
    g.translate(-2.8, -2.8);
    g.strokeStyle = "rgb(5 2 14 / 0.78)";
    g.lineWidth = 3;
    g.stroke(path);
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 1;
    g.stroke(path);
  }
}

/** A screw sunk in a countersink: the recess's far wall catches the light, the head is domed with a cross slot. */
function screw(g: CanvasRenderingContext2D, x: number, y: number, r = 5): void {
  const sink = g.createLinearGradient(x - r, y - r, x + r, y + r);
  sink.addColorStop(0, "#0c0818");
  sink.addColorStop(1, "#5d5390");
  g.fillStyle = sink;
  g.beginPath();
  g.arc(x, y, r + 1.6, 0, Math.PI * 2);
  g.fill();
  const head = g.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
  head.addColorStop(0, "#8d84b8");
  head.addColorStop(0.55, "#4a4174");
  head.addColorStop(1, "#231c40");
  g.fillStyle = head;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgb(10 6 22 / 0.9)";
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(x - r * 0.55, y);
  g.lineTo(x + r * 0.55, y);
  g.moveTo(x, y - r * 0.55);
  g.lineTo(x, y + r * 0.55);
  g.stroke();
  g.strokeStyle = "rgb(220 210 255 / 0.3)";
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x - r * 0.5, y + 1);
  g.lineTo(x + r * 0.5, y + 1);
  g.stroke();
}

// ---- free board -----------------------------------------------------------------------------------------------------

/** Which bits of the board are free for parts and copper, on a 4 px grid: plate interiors, less what is read. */
class Space {
  private readonly cols: number;
  private readonly rows: number;
  private readonly used: Uint8Array;
  static readonly CELL = 4;

  constructor(w: number, h: number) {
    this.cols = Math.ceil(w / Space.CELL);
    this.rows = Math.ceil(h / Space.CELL);
    this.used = new Uint8Array(this.cols * this.rows).fill(1);
  }

  private each(r: Rect, fn: (i: number) => boolean | void): boolean {
    const C = Space.CELL;
    const x0 = Math.max(0, Math.floor(r.x / C));
    const y0 = Math.max(0, Math.floor(r.y / C));
    const x1 = Math.min(this.cols - 1, Math.floor((r.x + r.w) / C));
    const y1 = Math.min(this.rows - 1, Math.floor((r.y + r.h) / C));
    if (r.x < 0 || r.y < 0 || r.x + r.w > this.cols * C || r.y + r.h > this.rows * C) return false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fn(y * this.cols + x) === false) return false;
    return true;
  }

  open(r: Rect): void {
    this.each(r, (i) => void (this.used[i] = 0));
  }

  take(r: Rect): void {
    const C = Space.CELL;
    const clipped = { x: Math.max(0, r.x), y: Math.max(0, r.y), w: 0, h: 0 };
    clipped.w = Math.min(this.cols * C, r.x + r.w) - clipped.x;
    clipped.h = Math.min(this.rows * C, r.y + r.h) - clipped.y;
    if (clipped.w > 0 && clipped.h > 0) this.each(clipped, (i) => void (this.used[i] = 1));
  }

  takeCircle(c: Point, r: number): void {
    const C = Space.CELL;
    for (let y = Math.floor((c.y - r) / C); y <= Math.floor((c.y + r) / C); y++)
      for (let x = Math.floor((c.x - r) / C); x <= Math.floor((c.x + r) / C); x++)
        if (x >= 0 && y >= 0 && x < this.cols && y < this.rows && Math.hypot((x + 0.5) * C - c.x, (y + 0.5) * C - c.y) < r + C)
          this.used[y * this.cols + x] = 1;
  }

  /** Marks a band `r` px either side of the polyline. */
  takePoly(poly: readonly Point[], r: number): void {
    for (const p of sample(poly, Space.CELL)) this.take({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 });
  }

  free(r: Rect): boolean {
    return this.each(r, (i) => this.used[i] === 0);
  }

  freePoly(poly: readonly Point[], r: number): boolean {
    return sample(poly, Space.CELL).every((p) => this.free({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 }));
  }
}

/** Points every `step` px along a polyline, its corners included. */
function sample(poly: readonly Point[], step: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  const last = poly[poly.length - 1];
  if (last) out.push(last);
  return out;
}

/** What is read on the stage: no part, screw or copper goes under it. */
function readRects(l: Layout): Rect[] {
  const g = l.gauge;
  return [
    ...l.ports.map((p) => p.module),
    l.clock,
    { x: g.centre.x - g.radius, y: g.centre.y - g.radius, w: g.radius * 2, h: g.radius * 2 },
    l.title,
    l.facts,
    l.play,
    l.txbar,
    ...l.rack,
  ];
}

/** Where pages stand their seat panels beside the core: only low parts there, nothing that stands up. */
function lowZones(l: Layout): Rect[] {
  const { centre: c, collar } = l.core;
  if (l.orientation === "portrait") return [{ x: 0, y: l.title.y - 40, w: l.width, h: l.play.y + l.play.h + 20 - (l.title.y - 40) }];
  const top = l.title.y - 10;
  const h = Math.min(...l.rack.map((r) => r.y)) - 60 - top;
  const w = c.x - collar - 40;
  return [
    { x: 0, y: top, w, h },
    { x: l.width - w, y: top, w, h },
  ];
}

function screwsFor(l: Layout, plates: readonly Plate[], traces: readonly Trace[]): Point[] {
  const space = new Space(l.width, l.height);
  for (const p of plates) space.open(inflate(p.r, -6));
  for (const r of readRects(l)) space.take(inflate(r, 4));
  space.takeCircle(l.core.centre, l.core.collar + 12);
  for (const t of traces) space.takePoly(t.points, t.width / 2 + 7);
  const out: Point[] = [];
  for (const p of plates) {
    const [tl, tr, br, bl] = p.c;
    const k = 13;
    const { x, y, w, h } = p.r;
    const corners = [
      { x: x + k + tl * 0.45, y: y + k + tl * 0.45 },
      { x: x + w - k - tr * 0.45, y: y + k + tr * 0.45 },
      { x: x + w - k - br * 0.45, y: y + h - k - br * 0.45 },
      { x: x + k + bl * 0.45, y: y + h - k - bl * 0.45 },
    ];
    for (const s of corners) {
      const box = { x: s.x - 7, y: s.y - 7, w: 14, h: 14 };
      if (!space.free(box)) continue;
      space.take(box);
      out.push(s);
    }
  }
  return out;
}

// ---- parts ----------------------------------------------------------------------------------------------------------

type Kind = "soic" | "tssop" | "qfn" | "res" | "mlcc" | "array" | "elcap" | "crystal" | "header" | "pad" | "standoff";

interface Part {
  readonly kind: Kind;
  readonly r: Rect;
  /** Turned a quarter: pins along the short sides become pins along the long ones. */
  readonly v: boolean;
}

const FOOT: Record<Kind, readonly [number, number]> = {
  soic: [26, 14],
  tssop: [20, 9],
  qfn: [18, 18],
  res: [10, 5],
  mlcc: [8, 4],
  array: [20, 9],
  elcap: [16, 16],
  crystal: [16, 7],
  header: [22, 12],
  pad: [7, 7],
  standoff: [12, 12],
};

const TALL: ReadonlySet<Kind> = new Set<Kind>(["elcap", "crystal", "header", "standoff"]);
const CHIPS: readonly Kind[] = ["soic", "soic", "tssop", "qfn", "elcap", "crystal", "header", "standoff"];
const SMALL: readonly Kind[] = ["res", "res", "mlcc", "mlcc", "array", "pad"];

/** Parts and unlit copper scattered in the free board: chips, each with a few passives round it, then walks. */
function scatter(l: Layout, plates: readonly Plate[], traces: readonly Trace[], screws: readonly Point[]) {
  const rand = mulberry32(l.orientation === "portrait" ? 23 : 11);
  const space = new Space(l.width, l.height);
  for (const p of plates) space.open(inflate(p.r, -10));
  for (const r of readRects(l)) space.take(inflate(r, 8));
  space.takeCircle(l.core.centre, l.core.collar + 22);
  for (const t of traces) space.takePoly(t.points, t.width / 2 + 9);
  for (const s of screws) space.take({ x: s.x - 10, y: s.y - 10, w: 20, h: 20 });
  // The connectors at the parts' edges.
  for (const t of traces) if (t.plug) space.take({ x: t.plug.x - 16, y: t.plug.y - 16, w: 32, h: 32 });
  const low = lowZones(l);

  const parts: Part[] = [];
  const place = (kind: Kind, x: number, y: number, v: boolean): boolean => {
    const [fw, fh] = FOOT[kind];
    const w = v ? fh : fw;
    const h = v ? fw : fh;
    const r = { x: Math.round(x), y: Math.round(y), w, h };
    const room = inflate(r, 6);
    if (!space.free(room)) return false;
    if (TALL.has(kind) && low.some((z) => rectsOverlap(z, r))) return false;
    space.take(room);
    parts.push({ kind, r, v });
    return true;
  };
  const area = l.width * l.height;
  const chips = Math.round(area / 52000);
  for (let n = 0, tries = 0; n < chips && tries < 1500; tries++) {
    const kind = CHIPS[Math.floor(rand() * CHIPS.length)]!;
    const v = rand() < 0.35;
    const x = rand() * l.width;
    const y = rand() * l.height;
    if (!place(kind, x, y, v)) continue;
    n++;
    const at = parts[parts.length - 1]!.r;
    // Its passives: a few small parts close by, in a row the way a board is laid out.
    const k = 2 + Math.floor(rand() * 3);
    const row = rand() < 0.5;
    for (let j = 0, t = 0; j < k && t < 12; t++) {
      const small = SMALL[Math.floor(rand() * SMALL.length)]!;
      const along = j * 14;
      const ok = row
        ? place(small, at.x + along, at.y + at.h + 10 + rand() * 6, false)
        : place(small, at.x + at.w + 10 + rand() * 6, at.y + along, true);
      if (ok) j++;
    }
  }
  const loose = Math.round(area / 30000);
  for (let n = 0, tries = 0; n < loose && tries < 1500; tries++) {
    const kind = SMALL[Math.floor(rand() * SMALL.length)]!;
    if (place(kind, rand() * l.width, rand() * l.height, rand() < 0.4)) n++;
  }

  // Unlit copper: short walks with 45° turns, a via at the far end and sometimes at the start.
  const walks: Point[][] = [];
  const vias: Point[] = [];
  const heads = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) }));
  const count = Math.round(area / 16000);
  for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
    let hd = Math.floor(rand() * 4) * 2 + (rand() < 0.3 ? 1 : 0);
    const pts: Point[] = [{ x: Math.round((rand() * l.width) / 4) * 4, y: Math.round((rand() * l.height) / 4) * 4 }];
    const segs = 2 + Math.floor(rand() * 3);
    for (let s = 0; s < segs; s++) {
      const d = heads[hd % 8]!;
      const len = 16 + Math.floor(rand() * 10) * 8;
      const p = pts[pts.length - 1]!;
      pts.push({ x: p.x + d.x * len, y: p.y + d.y * len });
      hd = (hd + (rand() < 0.5 ? 1 : 7)) % 8;
    }
    if (!space.freePoly(pts, 6)) continue;
    space.takePoly(pts, 6);
    walks.push(pts);
    vias.push(pts[pts.length - 1]!);
    if (rand() < 0.4) vias.push(pts[0]!);
    n++;
  }
  const fiducials: Point[] = [];
  for (let n = 0, tries = 0; n < 4 && tries < 200; tries++) {
    const p = { x: 20 + rand() * (l.width - 40), y: 20 + rand() * (l.height - 40) };
    const box = { x: p.x - 8, y: p.y - 8, w: 16, h: 16 };
    if (!space.free(box)) continue;
    space.take(box);
    fiducials.push(p);
    n++;
  }
  return { parts, walks, vias, fiducials };
}

/** Raised parts cast a short soft shadow down and a little right (the key light is top left). */
function cast(g: CanvasRenderingContext2D, on: boolean, lift = 1): void {
  g.shadowColor = on ? "rgb(3 1 10 / 0.75)" : "transparent";
  g.shadowBlur = on ? 3 + lift : 0;
  g.shadowOffsetX = on ? 1.2 * lift : 0;
  g.shadowOffsetY = on ? 2.5 * lift : 0;
}

function silver(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const s = g.createLinearGradient(0, y0, 0, y1);
  s.addColorStop(0, "#eeebf8");
  s.addColorStop(1, "#86809f");
  return s;
}

/** An IC package: silver legs (along the long sides, or all four for a QFN), a moulded body lit on its top edge. */
function chip(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w, h } = p.r;
  const allSides = p.kind === "qfn";
  const pitch = p.kind === "tssop" ? 3 : 4.5;
  const legs = new Path2D();
  const row = (len: number, fn: (o: number) => void): void => {
    const n = Math.max(2, Math.floor((len - 4) / pitch));
    const start = (len - (n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) fn(start + i * pitch);
  };
  const across = !p.v; // legs on the top and bottom edges
  if (allSides || across) row(w, (o) => (legs.rect(x + o - 0.8, y - 3, 1.6, 3), legs.rect(x + o - 0.8, y + h, 1.6, 3)));
  if (allSides || !across) row(h, (o) => (legs.rect(x - 3, y + o - 0.8, 3, 1.6), legs.rect(x + w, y + o - 0.8, 3, 1.6)));
  g.fillStyle = silver(g, y - 3, y + h + 3);
  g.fill(legs);
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, "#4d4769");
  body.addColorStop(1, "#1c1930");
  g.fillStyle = body;
  cast(g, true);
  g.beginPath();
  g.roundRect(x, y, w, h, 1.5);
  g.fill();
  cast(g, false);
  g.strokeStyle = "rgb(255 255 255 / 0.3)";
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x + 1.5, y + 0.6);
  g.lineTo(x + w - 1.5, y + 0.6);
  g.stroke();
  g.strokeStyle = "rgb(0 0 0 / 0.5)";
  g.beginPath();
  g.moveTo(x + 1.5, y + h - 0.5);
  g.lineTo(x + w - 1.5, y + h - 0.5);
  g.stroke();
  // Pin 1's dimple, and the faint laser marking across the top.
  g.fillStyle = "rgb(0 0 0 / 0.55)";
  g.beginPath();
  g.arc(x + 3.2, y + 3.2, 1.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgb(210 200 240 / 0.16)";
  if (w >= h) g.fillRect(x + w * 0.3, y + h / 2 - 0.5, w * 0.5, 1);
  else g.fillRect(x + w / 2 - 0.5, y + h * 0.3, 1, h * 0.5);
}

/** A two-terminal chip part: silver end caps, a black (resistor) or tan (capacitor) body; or a row of three. */
function passive(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w, h } = p.r;
  const one = (r: Rect, body: string): void => {
    const long = r.w >= r.h;
    g.fillStyle = "rgb(3 1 10 / 0.5)";
    g.fillRect(r.x + 0.8, r.y + 1.5, r.w, r.h);
    g.fillStyle = silver(g, r.y, r.y + r.h);
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = body;
    if (long) g.fillRect(r.x + r.w * 0.24, r.y, r.w * 0.52, r.h);
    else g.fillRect(r.x, r.y + r.h * 0.24, r.w, r.h * 0.52);
    g.fillStyle = "rgb(255 255 255 / 0.28)";
    g.fillRect(r.x, r.y, r.w, 0.8);
  };
  if (p.kind === "array") {
    const n = 3;
    for (let i = 0; i < n; i++)
      one(p.v ? { x, y: y + (i * h) / n + 0.5, w, h: h / n - 1 } : { x: x + (i * w) / n + 0.5, y, w: w / n - 1, h }, "#1a1625");
    return;
  }
  one(p.r, p.kind === "res" ? "#1a1625" : "#b39a74");
}

/** An electrolytic can seen from above: its plastic base, the lit can with its vent cross and polarity band. */
function elcap(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w } = p.r;
  const cx = x + w / 2;
  const cy = y + w / 2;
  const rad = w / 2 - 1;
  g.fillStyle = "#26213a";
  cast(g, true, 1.4);
  g.beginPath();
  g.roundRect(x, y, w, w, 2.5);
  g.fill();
  const can = g.createRadialGradient(cx - rad * 0.4, cy - rad * 0.45, 0, cx, cy, rad);
  can.addColorStop(0, "#f2effa");
  can.addColorStop(0.5, "#a7a1c4");
  can.addColorStop(1, "#5a5378");
  g.fillStyle = can;
  g.beginPath();
  g.arc(cx, cy, rad, 0, Math.PI * 2);
  g.fill();
  cast(g, false);
  g.fillStyle = "rgb(40 34 70 / 0.8)";
  g.beginPath();
  g.arc(cx, cy, rad, Math.PI * 0.6, Math.PI * 1.15);
  g.arc(cx, cy, rad * 0.72, Math.PI * 1.15, Math.PI * 0.6, true);
  g.fill();
  g.strokeStyle = "rgb(40 34 70 / 0.65)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - rad * 0.45, cy);
  g.lineTo(cx + rad * 0.45, cy);
  g.moveTo(cx, cy - rad * 0.45);
  g.lineTo(cx, cy + rad * 0.45);
  g.stroke();
}

/** A crystal: a rounded metal can, lit along its top. */
function crystal(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w, h } = p.r;
  const can = g.createLinearGradient(0, y, 0, y + h);
  can.addColorStop(0, "#e6e2f2");
  can.addColorStop(1, "#6f6990");
  g.fillStyle = can;
  cast(g, true, 1.2);
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(w, h) / 2);
  g.fill();
  cast(g, false);
  g.strokeStyle = "rgb(255 255 255 / 0.55)";
  g.lineWidth = 0.8;
  g.beginPath();
  g.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, Math.min(w, h) / 2 - 1.5);
  g.stroke();
}

/** A pin header: a dark moulded strip with two rows of gold square pins, each lit on its top face. */
function header(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w, h } = p.r;
  g.fillStyle = "#1b1729";
  cast(g, true, 1.2);
  g.beginPath();
  g.roundRect(x, y, w, h, 1.5);
  g.fill();
  cast(g, false);
  const across = w >= h;
  const n = Math.floor((across ? w : h) / 5.5);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < 2; j++) {
      const px = across ? x + 2.5 + i * 5.5 : x + 2 + j * (w / 2);
      const py = across ? y + 2 + j * (h / 2) : y + 2.5 + i * 5.5;
      g.fillStyle = "#7a5d22";
      g.fillRect(px, py, 3, 3);
      g.fillStyle = "#e9cd7c";
      g.fillRect(px, py, 3, 1.6);
    }
}

/** A gold test pad or a standoff screw boss. */
function pad(g: CanvasRenderingContext2D, p: Part): void {
  const { x, y, w } = p.r;
  const cx = x + w / 2;
  const cy = y + w / 2;
  if (p.kind === "standoff") {
    screw(g, cx, cy, w / 2 - 2);
    return;
  }
  const gold = g.createLinearGradient(x, y, x + w, y + w);
  gold.addColorStop(0, "#f4dc95");
  gold.addColorStop(1, "#8a6a2a");
  g.fillStyle = gold;
  g.beginPath();
  g.arc(cx, cy, w / 2 - 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgb(40 26 4 / 0.6)";
  g.beginPath();
  g.arc(cx, cy, w / 6, 0, Math.PI * 2);
  g.fill();
}

function drawPart(g: CanvasRenderingContext2D, p: Part): void {
  if (p.kind === "soic" || p.kind === "tssop" || p.kind === "qfn") chip(g, p);
  else if (p.kind === "res" || p.kind === "mlcc" || p.kind === "array") passive(g, p);
  else if (p.kind === "elcap") elcap(g, p);
  else if (p.kind === "crystal") crystal(g, p);
  else if (p.kind === "header") header(g, p);
  else pad(g, p);
}

/** Silkscreen: each part's courtyard outline, a polarity tick by the cans, and the board's fiducials. */
function drawSilk(g: CanvasRenderingContext2D, parts: readonly Part[], fiducials: readonly Point[]): void {
  g.strokeStyle = "rgb(214 204 240 / 0.2)";
  g.lineWidth = 1;
  for (const p of parts) {
    if (p.kind === "pad" || p.kind === "standoff") continue;
    const r = inflate(p.r, p.kind === "res" || p.kind === "mlcc" ? 2 : 4);
    g.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    if (p.kind === "elcap") {
      g.beginPath();
      g.moveTo(r.x - 6, r.y + 3);
      g.lineTo(r.x - 2, r.y + 3);
      g.moveTo(r.x - 4, r.y + 1);
      g.lineTo(r.x - 4, r.y + 5);
      g.stroke();
    }
  }
  for (const f of fiducials) {
    g.beginPath();
    g.arc(f.x, f.y, 5.5, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgb(214 204 240 / 0.35)";
    g.beginPath();
    g.arc(f.x, f.y, 2, 0, Math.PI * 2);
    g.fill();
  }
}

/** Unlit copper: thin traces with a lit top edge, ending at vias (a copper ring round a dark drill). */
function drawCopper(g: CanvasRenderingContext2D, walks: readonly Point[][], vias: readonly Point[]): void {
  const path = new Path2D();
  for (const w of walks) bend(path, w, 4);
  g.lineJoin = "round";
  g.lineCap = "round";
  g.save();
  g.translate(0, 1);
  g.strokeStyle = "rgb(4 2 12 / 0.6)";
  g.lineWidth = 2.4;
  g.stroke(path);
  g.restore();
  g.strokeStyle = "#433a70";
  g.lineWidth = 1.6;
  g.stroke(path);
  g.save();
  g.translate(0, -0.4);
  g.strokeStyle = "rgb(190 176 255 / 0.18)";
  g.lineWidth = 0.7;
  g.stroke(path);
  g.restore();
  for (const v of vias) {
    g.fillStyle = "#4c4280";
    g.beginPath();
    g.arc(v.x, v.y, 3.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgb(210 196 255 / 0.25)";
    g.beginPath();
    g.arc(v.x, v.y - 0.6, 3.2, Math.PI * 1.1, Math.PI * 1.9);
    g.arc(v.x, v.y, 2.2, Math.PI * 1.9, Math.PI * 1.1, true);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(v.x, v.y, 1.3, 0, Math.PI * 2);
    g.fill();
  }
}

// ---- the neon -------------------------------------------------------------------------------------------------------

/** A polyline into a path, its 45° bends eased with a small radius the way routed copper is. */
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

/** The pastel line down a lit trace's middle. */
export function pastel(colour: string, k = 0.6): string {
  return tint(colour, k);
}

/**
 * Lit copper in layers, each a handful of strokes (traces of one colour and width share a path): the channel it lies
 * in (its lower lip catching the light), the dark copper bed, a short glow of translucent strokes (6 px past the
 * line's edge), the coloured line and its pastel core.
 */
function drawNeon(g: CanvasRenderingContext2D, traces: readonly Trace[]): void {
  const groups = new Map<string, { path: Path2D; colour: string; width: number }>();
  for (const t of traces) {
    const key = `${t.colour}/${t.width}`;
    let grp = groups.get(key);
    if (!grp) groups.set(key, (grp = { path: new Path2D(), colour: t.colour, width: t.width }));
    bend(grp.path, t.points);
  }
  const list = [...groups.values()];
  g.lineJoin = "round";
  g.lineCap = "round";
  g.save();
  g.translate(0.4, 1.4);
  g.strokeStyle = "rgb(170 150 240 / 0.16)";
  for (const grp of list) {
    g.lineWidth = grp.width + 9;
    g.stroke(grp.path);
  }
  g.restore();
  g.save();
  g.translate(0, 0.4);
  g.strokeStyle = "#0a0617";
  for (const grp of list) {
    g.lineWidth = grp.width + 7;
    g.stroke(grp.path);
  }
  g.restore();
  for (const [extra, a] of [
    [12, 0.07],
    [8, 0.11],
    [4.5, 0.2],
  ] as const)
    for (const grp of list) {
      g.strokeStyle = alpha(grp.colour, a);
      g.lineWidth = grp.width + extra;
      g.stroke(grp.path);
    }
  for (const grp of list) {
    g.strokeStyle = grp.colour;
    g.lineWidth = grp.width;
    g.stroke(grp.path);
    g.strokeStyle = pastel(grp.colour);
    g.lineWidth = Math.max(1.2, grp.width * 0.42);
    g.stroke(grp.path);
  }
}

/** Where a part's bundle plugs in: a silver housing across its lines, each line's contact lit in its colour. */
function drawPlugs(g: CanvasRenderingContext2D, traces: readonly Trace[]): void {
  const bundles = new Map<string, Trace[]>();
  for (const t of traces) if (t.plug) bundles.set(t.bundle, [...(bundles.get(t.bundle) ?? []), t]);
  for (const lines of bundles.values()) {
    const first = lines[0]!.plug!;
    const a = first.angle;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const nrm = { x: -dir.y, y: dir.x };
    const across = lines.map((t) => (t.plug!.x - first.x) * nrm.x + (t.plug!.y - first.y) * nrm.y);
    const lo = Math.min(...across);
    const hi = Math.max(...across);
    const mid = { x: first.x + nrm.x * ((lo + hi) / 2) + dir.x * 5, y: first.y + nrm.y * ((lo + hi) / 2) + dir.y * 5 };
    const span = hi - lo + 12;
    const depth = 10;
    // Axis-aligned: draw in the housing's own frame, but light it from the screen's top left.
    const horizontal = Math.abs(dir.x) > Math.abs(dir.y);
    const w = horizontal ? depth : span;
    const h = horizontal ? span : depth;
    const x = mid.x - w / 2;
    const y = mid.y - h / 2;
    const body = g.createLinearGradient(0, y, 0, y + h);
    body.addColorStop(0, "#f1eef9");
    body.addColorStop(1, "#8d87aa");
    g.fillStyle = body;
    cast(g, true, 1.2);
    g.beginPath();
    g.roundRect(x, y, w, h, 2);
    g.fill();
    cast(g, false);
    g.fillStyle = "#231d3a";
    g.beginPath();
    g.roundRect(x + 2.5, y + 2.5, w - 5, h - 5, 1);
    g.fill();
    g.fillStyle = "rgb(255 255 255 / 0.85)";
    g.fillRect(x + 2, y + 0.6, w - 4, 0.9);
    for (const t of lines) {
      const o = (t.plug!.x - first.x) * nrm.x + (t.plug!.y - first.y) * nrm.y;
      const cx = first.x + nrm.x * o + dir.x * 5;
      const cy = first.y + nrm.y * o + dir.y * 5;
      g.fillStyle = alpha(t.colour, 0.35);
      if (horizontal) g.fillRect(x + 2, cy - 2.4, w - 4, 4.8);
      else g.fillRect(cx - 2.4, y + 2, 4.8, h - 4);
      g.fillStyle = pastel(t.colour, 0.45);
      if (horizontal) g.fillRect(x + 3, cy - 1.2, w - 6, 2.4);
      else g.fillRect(cx - 1.2, y + 3, 2.4, h - 6);
    }
  }
}

/** Each line's landing pad on the collar: a dark pad along its last stretch, rimmed and lit in its colour. */
function drawLandings(g: CanvasRenderingContext2D, traces: readonly Trace[]): void {
  for (const t of traces) {
    const end = t.points[t.points.length - 1];
    const before = t.points[t.points.length - 2];
    if (!end || !before) continue;
    const a = Math.atan2(end.y - before.y, end.x - before.x);
    const len = 15;
    const wide = t.width + 5;
    g.save();
    g.translate(end.x, end.y);
    g.rotate(a);
    g.fillStyle = "#0a0617";
    g.beginPath();
    g.roundRect(-len, -wide / 2 - 1.5, len + 4, wide + 3, 3);
    g.fill();
    g.strokeStyle = pastel(t.colour, 0.3);
    g.lineWidth = 1.4;
    g.beginPath();
    g.roundRect(-len + 1, -wide / 2, len + 2, wide, 2.5);
    g.stroke();
    g.fillStyle = pastel(t.colour, 0.55);
    g.fillRect(-len + 3.5, -t.width * 0.25, len - 1, t.width * 0.5);
    g.restore();
  }
}

/** The room's light falls off toward the stage's corners (shade only: nothing is lit that isn't a light). */
function drawFalloff(g: CanvasRenderingContext2D, l: Layout): void {
  const c = l.core.centre;
  const r = Math.hypot(Math.max(c.x, l.width - c.x), Math.max(c.y, l.height - c.y));
  const v = g.createRadialGradient(c.x, c.y, l.core.collar, c.x, c.y, r);
  v.addColorStop(0, "rgb(6 3 16 / 0)");
  v.addColorStop(0.5, "rgb(6 3 16 / 0.12)");
  v.addColorStop(1, "rgb(6 3 16 / 0.42)");
  g.fillStyle = v;
  g.fillRect(0, 0, l.width, l.height);
}

function paint(g: CanvasRenderingContext2D, l: Layout): void {
  const traces = tracesFor(l).all;
  const plates = platesFor(l);
  drawGround(g, l);
  drawPlates(g, plates);
  const screws = screwsFor(l, plates, traces);
  const { parts, walks, vias, fiducials } = scatter(l, plates, traces, screws);
  drawCopper(g, walks, vias);
  drawSilk(g, parts, fiducials);
  for (const s of screws) screw(g, s.x, s.y);
  for (const p of parts) drawPart(g, p);
  drawFalloff(g, l);
  drawNeon(g, traces);
  drawLandings(g, traces);
  drawPlugs(g, traces);
}
