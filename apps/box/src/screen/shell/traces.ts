// The Grid's light lines for a layout: the named traces packets ride (each port, the clock and each cartridge
// housing into the core's collar) and the decorative bundles that run in from the stage's side edges. Routed with
// 45° bends only, no trace crossing another or running under what is read (the title, facts, Play, the ports' and
// the clock's modules, the rack), except a port's own module, which its trace must leave. Pure: grid.ts draws these,
// packets.ts runs light along them.
import type { Layout, Point, Rect } from "./layout.ts";
import { bus, chamfer, clipCircle, exitRect, join, offset, route, type Poly, type Sample } from "./route.ts";

export type SlotTrace = "slot0" | "slot1" | "slot2" | "slot3";
export type TraceName = "port0" | "port1" | "clock" | SlotTrace;
export const TRACE_NAMES: readonly TraceName[] = ["port0", "port1", "clock", "slot0", "slot1", "slot2", "slot3"];

/** The light, as tokens.css has it (--p1, --p2, --sys): a port's trace is its seat's colour, every other the system's. */
export const LIGHT = { p1: "#ff9b3d", p2: "#3fd9ff", sys: "#cfe8f6" } as const;

export interface Trace {
  /** The named trace, or null for a line that only rides beside one or is decoration. */
  readonly name: TraceName | null;
  /** Lines drawn, plugged and lit together share a bundle; a named trace's bundle is its name. */
  readonly bundle: string;
  readonly points: readonly Point[];
  readonly colour: string;
  /** The coloured line's width (stage px). */
  readonly width: number;
  /** Where the trace's connector sits and the way the trace leaves it; null where it runs off the stage's edge. */
  readonly plug: Sample | null;
}

export interface Traces {
  readonly named: Readonly<Record<TraceName, Trace>>;
  /** Every light line on the Grid, named ones included. */
  readonly all: readonly Trace[];
}

const cache = new Map<Layout, Traces>();

export function tracesFor(layout: Layout): Traces {
  const hit = cache.get(layout);
  if (hit) return hit;
  const all = layout.orientation === "portrait" ? portrait(layout) : landscape(layout);
  const named = {} as Record<TraceName, Trace>;
  for (const t of all) if (t.name) named[t.name] = t;
  for (const n of TRACE_NAMES) if (!named[n]) throw new Error(`trace ${n} was not routed`);
  const traces = { named, all };
  cache.set(layout, traces);
  return traces;
}

// ---- landscape ------------------------------------------------------------------------------------------------------

function landscape(l: Layout): Trace[] {
  const { centre: c, collar } = l.core;
  const out: Trace[] = [];

  // Each port drops out of its module under the ring, runs along between the ports and the title, and dives at 45°
  // into the collar's upper corner; the diagonal starts a little outside the radial one, clear of the title.
  l.ports.forEach((p, seat) => {
    const s = p.side === "left" ? 1 : -1;
    const lane = p.module.y + p.module.h + 36;
    const x = c.x - s * (c.y - lane + 20);
    const centre = join(route(p.ring, { x, y: lane }, { axis: "y", lead: lane - p.ring.y - 24 }), [{ x, y: lane }, { x: x + s * 400, y: lane + 400 }]);
    out.push(...lit(`port${seat}` as TraceName, bus(centre, 3, 10), seat === 0 ? LIGHT.p1 : LIGHT.p2, 4, l, p.module));
  });

  out.push(...clockFeed(l));

  // Each cartridge's feed rises from its housing's top into the collar's underside, fanned across the bottom arc in
  // rack order: the inner ones straight up and in, the outer ones along a lane first. Each has a companion outside it.
  sideRanks(l).forEach(({ i, s, rank }) => {
    const h = l.rack[i]!;
    const start = { x: h.x + h.w / 2, y: h.y };
    const target = onCollar(l, 180 + s * (12 + 20 * rank));
    const centre =
      start.y - target.y >= Math.abs(target.x - start.x) + 12
        ? route(start, target, { axis: "y" })
        : chamfer(join(route(start, { x: start.x, y: h.y - 60 }), route({ x: start.x, y: h.y - 60 }, target, { axis: "x" })), 18);
    const deeper = extend(centre, 40);
    const name = `slot${i}` as SlotTrace;
    out.push(...lit(name, [deeper], LIGHT.sys, 4.5, l, null, h));
    out.push(...lit(name, [offset(deeper, -s * 9)], LIGHT.sys, 3, l, null, h, false));
  });

  // Decoration from the side edges: a pair below Play into the collar's lower left and its mirror on the right, and
  // two bundles across the open right side, each stepping once at 45° on its way in.
  const low = l.play.y + l.play.h + 30;
  out.push(...edge("left-low", fromEdge(-4, low, onCollar(l, 240)), 2, 12, l));
  out.push(...edge("right-low", fromEdge(l.width + 4, low, onCollar(l, 120)), 2, 12, l));
  const upper = c.y - 44;
  out.push(
    ...edge(
      "right-upper",
      join(route({ x: l.width + 4, y: upper - 38 }, { x: c.x + collar + 60, y: upper }, { axis: "x", lead: 270 }), [{ x: c.x, y: upper }]),
      3,
      11,
      l,
    ),
  );
  const mid = c.y + 26;
  out.push(
    ...edge(
      "right-mid",
      join(route({ x: l.width + 4, y: mid + 28 }, { x: c.x + collar + 60, y: mid }, { axis: "x", lead: 190 }), [{ x: c.x, y: mid }]),
      2,
      11,
      l,
    ),
  );
  return out;
}

// ---- portrait -------------------------------------------------------------------------------------------------------

function portrait(l: Layout): Trace[] {
  const { centre: c } = l.core;
  const out: Trace[] = [];
  const tx = l.txbar;

  // Each port drops straight out of its module, then dives at 45° past the transaction LCD's outer end into the
  // collar's upper side.
  l.ports.forEach((p, seat) => {
    const s = p.side === "left" ? 1 : -1;
    // The diagonal x − s·y = k clears the LCD's bottom outer corner by 28 px.
    const corner = s > 0 ? { x: tx.x, y: tx.y + tx.h } : { x: tx.x + tx.w, y: tx.y + tx.h };
    const k = corner.x - s * corner.y - s * 28;
    const turn = { x: p.ring.x, y: s * (p.ring.x - k) };
    const centre = [p.ring, turn, { x: turn.x + s * 400, y: turn.y + 400 }];
    out.push(...lit(`port${seat}` as TraceName, bus(centre, 3, 10), seat === 0 ? LIGHT.p1 : LIGHT.p2, 4, l, p.module));
  });

  out.push(...clockFeed(l));

  // The title and facts span the stage, so the feeds climb the side gutters: out of each housing's top, along a lane
  // under Play to the gutter (the inner cartridge on the higher lane), up past the title and in at 45°.
  const gutter = l.title.x / 2;
  sideRanks(l).forEach(({ i, s, rank }) => {
    const h = l.rack[i]!;
    const start = { x: h.x + h.w / 2, y: h.y };
    const gx = s > 0 ? gutter : l.width - gutter;
    const climb = [{ x: gx, y: h.y }, { x: gx, y: l.title.y - 2 }, { x: gx + s * 500, y: l.title.y - 502 }];
    // Travelling up, the right-hand side is +x: the inner lane (toward the stage's middle) is +7 on the left side.
    const line = offset(climb, (rank === 0 ? 1 : -1) * s * 7);
    const lane = h.y - 26 - 20 * (rank === 0 ? 1 : 0);
    const tail = [start, { x: start.x, y: lane }, { x: line[0]!.x, y: lane }];
    const path = chamfer(join(tail, line.slice(1)), 10);
    out.push(...lit(`slot${i}` as SlotTrace, [path], LIGHT.sys, 4.5, l, null, h));
  });

  // Decoration: a fine pair in from each side edge, in the narrow arc between the port's dive and the feeds' climb.
  const y = c.y - 37;
  out.push(...edge("left-mid", route({ x: -4, y: y - 40 }, { x: c.x, y }, { axis: "x", lead: 54 }), 2, 9, l, 3));
  out.push(...edge("right-mid", route({ x: l.width + 4, y: y - 40 }, { x: c.x, y }, { axis: "x", lead: 54 }), 2, 9, l, 3));
  return out;
}

// ---- shared ---------------------------------------------------------------------------------------------------------

/** The clock's feed: three lines straight down from the LCD's foot into the collar's top. */
function clockFeed(l: Layout): Trace[] {
  const start = { x: l.clock.x + l.clock.w / 2, y: l.clock.y + l.clock.h };
  const centre = [start, { x: start.x, y: l.core.centre.y }];
  return lit("clock", bus(centre, 3, 12), LIGHT.sys, 3.5, l, null, null, true, true);
}

/** Each rack slot, which side of the core it is on (+1 left: toward the core is +x) and its rank there (0 nearest). */
function sideRanks(l: Layout): { i: number; s: 1 | -1; rank: number }[] {
  const cx = l.core.centre.x;
  return l.rack.map((h, i) => {
    const x = h.x + h.w / 2;
    const s = x < cx ? 1 : -1;
    const rank = l.rack.filter((o) => {
      const ox = o.x + o.w / 2;
      return (ox < cx ? 1 : -1) === s && Math.abs(ox - cx) < Math.abs(x - cx);
    }).length;
    return { i, s, rank };
  });
}

/** The point on the collar at `deg` degrees clockwise from straight up. */
function onCollar(l: Layout, deg: number): Point {
  const a = (deg * Math.PI) / 180;
  const { centre: c, collar } = l.core;
  return { x: c.x + Math.sin(a) * collar, y: c.y - Math.cos(a) * collar };
}

/** From a side edge along a run and in at 45° to `target` on the collar. */
function fromEdge(x: number, y: number, target: Point): Point[] {
  return route({ x, y }, target, { axis: "x" });
}

/** The last segment carried on `by` px: lines offset beside a trace that ends on the collar still reach it. */
function extend(poly: Poly, by: number): Point[] {
  const a = poly[poly.length - 2];
  const b = poly[poly.length - 1];
  if (!a || !b) return [...poly];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return [...poly.slice(0, -1), { x: b.x + ((b.x - a.x) / len) * by, y: b.y + ((b.y - a.y) / len) * by }];
}

/**
 * Lines of one bundle, cut at the collar. The middle line carries the name (when `named`); the rest ride beside it.
 * The plug goes where the lines leave `module` (a port), at their start on the anchor's edge (a housing, the clock),
 * or nowhere for edge bundles.
 */
function lit(
  name: TraceName,
  lines: Point[][],
  colour: string,
  width: number,
  l: Layout,
  module: Rect | null,
  housing: Rect | null = null,
  named = true,
  atStart = housing !== null,
): Trace[] {
  const middle = Math.floor(lines.length / 2);
  return lines.map((line, i) => {
    const points = clipCircle(line, l.core.centre, l.core.collar);
    const first = points[0]!;
    const second = points[1] ?? first;
    const heading = Math.atan2(second.y - first.y, second.x - first.x);
    const plug = module ? exitRect(points, module) : atStart ? { x: first.x, y: first.y, angle: heading } : null;
    return { name: named && i === middle ? name : null, bundle: name, points, colour, width: i === middle ? width : width - 0.5, plug };
  });
}

/** A decorative bundle in from the stage's edge: `n` lines `pitch` apart in the system's light, cut at the collar. */
function edge(id: string, centre: Point[], n: number, pitch: number, l: Layout, width = 3.5): Trace[] {
  return bus(extend(centre, 40), n, pitch).map((line) => ({
    name: null,
    bundle: id,
    points: clipCircle(line, l.core.centre, l.core.collar),
    colour: LIGHT.sys,
    width,
    plug: null,
  }));
}
