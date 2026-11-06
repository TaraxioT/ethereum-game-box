// Board geometry, the way a circuit board is routed: straight runs and 45° bends, parallel buses that keep their
// pitch round every bend, sampling a point along a trace, and cutting a trace where it meets the core's collar.
// Pure (no DOM), so the traces and the board's free space can be tested in Node.
import type { Point, Rect } from "./layout.ts";

export type Poly = readonly Point[];

/** A point on a polyline and the direction it is heading there (radians, screen axes: y down). */
export interface Sample extends Point {
  readonly angle: number;
}

const EPS = 1e-6;
const sign = (n: number): number => (n < 0 ? -1 : 1);
const same = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

export interface RouteOptions {
  /** The axis the trace leaves `a` along. Default: the longer one. */
  readonly axis?: "x" | "y";
  /**
   * How far it runs along `axis` before its first bend, clamped to what the geometry allows. Along the longer axis
   * the default runs as far as it can, so the 45° diagonal comes last, into `b`; along the shorter axis it defaults
   * to 0 (the diagonal first, then straight along the other axis into `b`).
   */
  readonly lead?: number;
}

/** A trace from `a` to `b` with one straight run, one 45° diagonal and one more straight run (any may be empty). */
export function route(a: Point, b: Point, options: RouteOptions = {}): Point[] {
  const dxAbs = Math.abs(b.x - a.x);
  const dyAbs = Math.abs(b.y - a.y);
  const axis = options.axis ?? (dyAbs > dxAbs ? "y" : "x");
  // Work in (u along the leaving axis, v across it).
  const u = (p: Point): number => (axis === "x" ? p.x : p.y);
  const v = (p: Point): number => (axis === "x" ? p.y : p.x);
  const at = (pu: number, pv: number): Point => (axis === "x" ? { x: pu, y: pv } : { x: pv, y: pu });
  const du = u(b) - u(a);
  const dv = v(b) - v(a);
  const au = Math.abs(du);
  const av = Math.abs(dv);
  if (au < EPS || av < EPS) return simplify([a, b]);
  const su = sign(du);
  const sv = sign(dv);
  if (au >= av) {
    const lead = clamp(options.lead ?? Infinity, 0, au - av);
    return simplify([a, at(u(a) + su * lead, v(a)), at(u(a) + su * (lead + av), v(b)), b]);
  }
  const lead = clamp(options.lead ?? 0, 0, au);
  return simplify([a, at(u(a) + su * lead, v(a)), at(u(b), v(a) + sv * (au - lead)), b]);
}

/** Polylines joined end to start into one, the shared joints kept once. */
export function join(...parts: Poly[]): Point[] {
  return simplify(parts.flat());
}

/** Drops repeated points and the middle of any three in a line. */
export function simplify(poly: Poly): Point[] {
  const out: Point[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    const prev = out[out.length - 2];
    if (prev && last && Math.abs(cross(prev, last, p)) < 0.01 * Math.hypot(p.x - prev.x, p.y - prev.y)) out.pop();
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Cuts every corner sharper than 45° (a right angle, say) with a 45° chamfer `size` px along each side, so the trace
 * only ever bends by 45°. A corner with too little room on either side gets a smaller chamfer.
 */
export function chamfer(poly: Poly, size: number): Point[] {
  if (poly.length < 3) return simplify(poly);
  const out: Point[] = [poly[0]!];
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const c = poly[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (l1 * l2);
    if (cos > Math.SQRT1_2 - 0.01) {
      out.push(b);
      continue;
    }
    const k = Math.min(size, l1 / 2, l2 / 2);
    out.push({ x: b.x - ((b.x - a.x) / l1) * k, y: b.y - ((b.y - a.y) / l1) * k });
    out.push({ x: b.x + ((c.x - b.x) / l2) * k, y: b.y + ((c.y - b.y) / l2) * k });
  }
  out.push(poly[poly.length - 1]!);
  return simplify(out);
}

/**
 * The polyline moved sideways by `d` px (positive: to the right of its direction of travel, on screen), mitred at
 * every bend so a line drawn beside it stays exactly `d` away round 45° and 90° corners.
 */
export function offset(poly: Poly, d: number): Point[] {
  if (poly.length < 2) return poly.map((p) => ({ x: p.x, y: p.y }));
  const normal = (a: Point, b: Point): Point => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  };
  return poly.map((p, i) => {
    const n1 = i > 0 ? normal(poly[i - 1]!, p) : null;
    const n2 = i < poly.length - 1 ? normal(p, poly[i + 1]!) : null;
    if (!n1 || !n2) {
      const n = (n1 ?? n2)!;
      return { x: p.x + n.x * d, y: p.y + n.y * d };
    }
    const k = d / (1 + n1.x * n2.x + n1.y * n2.y);
    return { x: p.x + (n1.x + n2.x) * k, y: p.y + (n1.y + n2.y) * k };
  });
}

/** `n` traces `pitch` apart, centred on `centre` and parallel to it round every bend; left to right of travel. */
export function bus(centre: Poly, n: number, pitch: number): Point[][] {
  return Array.from({ length: n }, (_, i) => offset(centre, (i - (n - 1) / 2) * pitch));
}

/** Each vertex's distance along the polyline (the first is 0, the last is its length). */
export function lengths(poly: Poly): number[] {
  const out: number[] = [];
  let total = 0;
  poly.forEach((p, i) => {
    const q = poly[i - 1];
    if (q) total += Math.hypot(p.x - q.x, p.y - q.y);
    out.push(total);
  });
  return out;
}

/** The point `l` px along the polyline (clamped to its ends), given its `lengths`. */
export function pointAtLength(poly: Poly, cum: readonly number[], l: number): Sample {
  const n = poly.length;
  const first = poly[0];
  if (!first) return { x: 0, y: 0, angle: 0 };
  if (n < 2) return { x: first.x, y: first.y, angle: 0 };
  const total = cum[n - 1] ?? 0;
  const at = clamp(l, 0, total);
  let i = 1;
  while (i < n - 1 && (cum[i] ?? 0) < at) i++;
  const a = poly[i - 1]!;
  const b = poly[i]!;
  const c0 = cum[i - 1] ?? 0;
  const seg = (cum[i] ?? 0) - c0;
  const k = seg > EPS ? (at - c0) / seg : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** The point `t` (0 to 1) of the way along the polyline, and its heading there. */
export function pointAt(poly: Poly, t: number): Sample {
  const cum = lengths(poly);
  return pointAtLength(poly, cum, clamp(t, 0, 1) * (cum[cum.length - 1] ?? 0));
}

/** The stretch of the polyline between lengths `l0` and `l1` (clamped), corners included. */
export function slice(poly: Poly, cum: readonly number[], l0: number, l1: number): Point[] {
  const total = cum[cum.length - 1] ?? 0;
  const from = clamp(Math.min(l0, l1), 0, total);
  const to = clamp(Math.max(l0, l1), 0, total);
  const out: Point[] = [pointAtLength(poly, cum, from)];
  for (let i = 1; i < poly.length - 1; i++) {
    const c = cum[i] ?? 0;
    if (c > from && c < to) out.push(poly[i]!);
  }
  out.push(pointAtLength(poly, cum, to));
  return out.map((p) => ({ x: p.x, y: p.y }));
}

/** The polyline cut where it first enters the circle (`c`, `r`): traces end on the collar instead of running under. */
export function clipCircle(poly: Poly, c: Point, r: number): Point[] {
  const first = poly[0];
  if (!first) return [];
  if (Math.hypot(first.x - c.x, first.y - c.y) <= r) return [{ x: first.x, y: first.y }];
  const out: Point[] = [{ x: first.x, y: first.y }];
  for (let i = 1; i < poly.length; i++) {
    const p = poly[i - 1]!;
    const q = poly[i]!;
    const t = enterCircle(p, q, c, r);
    if (t !== null) {
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      return out;
    }
    out.push({ x: q.x, y: q.y });
  }
  return out;
}

/** Where segment p → q (p outside) first meets the circle, as a fraction of the segment; null if it never does. */
function enterCircle(p: Point, q: Point, c: Point, r: number): number | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const fx = p.x - c.x;
  const fy = p.y - c.y;
  const a = dx * dx + dy * dy;
  if (a < EPS) return null;
  const b = 2 * (fx * dx + fy * dy);
  const k = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** A rectangle grown by `pad` on every side (shrunk for a negative pad). */
export function inflate(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

export function inside(p: Point, r: Rect): boolean {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** Whether segment p → q passes through the rectangle's interior (Liang–Barsky). */
export function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [den, num] of edges) {
    if (Math.abs(den) < EPS) {
      if (num <= 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > EPS;
}

/** Whether any part of the polyline passes through the rectangle grown by `pad`. */
export function polyHitsRect(poly: Poly, r: Rect, pad = 0): boolean {
  const box = inflate(r, pad);
  if (poly.length === 1) return inside(poly[0]!, box);
  for (let i = 1; i < poly.length; i++) if (segmentHitsRect(poly[i - 1]!, poly[i]!, box)) return true;
  return false;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** Where segments p1 → p2 and q1 → q2 cross (null when they don't, or only touch at an end). */
export function crossing(p1: Point, p2: Point, q1: Point, q2: Point): Point | null {
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const d = rx * sy - ry * sx;
  if (Math.abs(d) < 1e-9) return null;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / d;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / d;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: p1.x + rx * t, y: p1.y + ry * t };
}

/**
 * Where the polyline, starting inside or on the edge of `r`, first leaves it, and its heading there. A polyline that
 * starts outside leaves at its start.
 */
export function exitRect(poly: Poly, r: Rect): Sample | null {
  const first = poly[0];
  if (!first) return null;
  for (let i = 1; i < poly.length; i++) {
    const p = poly[i - 1]!;
    const q = poly[i]!;
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    if (!inside(p, r)) return { x: p.x, y: p.y, angle };
    if (inside(q, r)) continue;
    // p is inside, q is not: walk the crossing in by halves.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (inside({ x: p.x + (q.x - p.x) * m, y: p.y + (q.y - p.y) * m }, r)) lo = m;
      else hi = m;
    }
    return { x: p.x + (q.x - p.x) * hi, y: p.y + (q.y - p.y) * hi, angle };
  }
  return null;
}
