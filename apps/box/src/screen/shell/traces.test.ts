import { describe, expect, it } from "vitest";
import { LANDSCAPE, PORTRAIT, type Layout, type Point, type Rect } from "./layout.ts";
import { crossing, inflate, polyHitsRect } from "./route.ts";
import { TRACE_NAMES, tracesFor, type Trace, type TraceName } from "./traces.ts";

const near = (a: Point, b: Point, tol = 0.5): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/** Where each named trace must start. */
function anchor(l: Layout, name: TraceName): Point {
  if (name === "port0" || name === "port1") return l.ports[name === "port0" ? 0 : 1].ring;
  if (name === "clock") return { x: l.clock.x + l.clock.w / 2, y: l.clock.y + l.clock.h };
  const h = l.rack[Number(name.slice(4))]!;
  return { x: h.x + h.w / 2, y: h.y };
}

/** What is read on the stage, and which bundles may pass through each (a port leaves its own module). */
function readRects(l: Layout): { what: string; rect: Rect; allow: string[] }[] {
  const g = l.gauge;
  return [
    { what: "title", rect: l.title, allow: [] },
    { what: "facts", rect: l.facts, allow: [] },
    { what: "play", rect: l.play, allow: [] },
    { what: "port0", rect: l.ports[0].module, allow: ["port0"] },
    { what: "port1", rect: l.ports[1].module, allow: ["port1"] },
    // A trace starting on an edge touches it: test the interior.
    { what: "clock", rect: inflate(l.clock, -1), allow: [] },
    { what: "gauge", rect: { x: g.centre.x - g.radius, y: g.centre.y - g.radius, w: g.radius * 2, h: g.radius * 2 }, allow: [] },
    // The LCD lies over the board: only the clock's feed runs under it.
    { what: "txbar", rect: l.txbar, allow: ["clock"] },
    ...l.rack.map((r) => ({ what: "rack", rect: inflate(r, -1), allow: [] })),
  ];
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The least distance between two polylines (they do not cross: checked separately). */
function polyDist(a: readonly Point[], b: readonly Point[]): number {
  let d = Infinity;
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const [p, q, r, s] = [a[i - 1]!, a[i]!, b[j - 1]!, b[j]!];
      d = Math.min(d, segDist(p, r, s), segDist(q, r, s), segDist(r, p, q), segDist(s, p, q));
    }
  return d;
}

describe.each([LANDSCAPE, PORTRAIT])("traces ($orientation)", (l) => {
  const { named, all } = tracesFor(l);
  const { centre, collar } = l.core;

  it("routes every named trace from its anchor onto the collar", () => {
    for (const name of TRACE_NAMES) {
      const t = named[name];
      expect(t.name).toBe(name);
      expect(near(t.points[0]!, anchor(l, name)), name).toBe(true);
      const end = t.points[t.points.length - 1]!;
      expect(Math.hypot(end.x - centre.x, end.y - centre.y), name).toBeCloseTo(collar, 1);
    }
  });

  it("ends every lit line on the collar, from on the stage or off its side edge", () => {
    for (const t of all) {
      const end = t.points[t.points.length - 1]!;
      expect(Math.hypot(end.x - centre.x, end.y - centre.y), t.bundle).toBeCloseTo(collar, 1);
      for (const p of t.points) {
        expect(p.x, t.bundle).toBeGreaterThanOrEqual(-5);
        expect(p.x, t.bundle).toBeLessThanOrEqual(l.width + 5);
        expect(p.y, t.bundle).toBeGreaterThanOrEqual(0);
        expect(p.y, t.bundle).toBeLessThanOrEqual(l.height);
      }
    }
  });

  it("bends by 45° only", () => {
    for (const t of all)
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1]!;
        const b = t.points[i]!;
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        expect(Math.abs(deg / 45 - Math.round(deg / 45)), `${t.bundle} segment ${i}`).toBeLessThan(0.01);
      }
  });

  it("stays out of what is read, except where it must", () => {
    for (const { what, rect, allow } of readRects(l))
      for (const t of all) if (!allow.includes(t.bundle)) expect(polyHitsRect(t.points, rect), `${t.bundle} through ${what}`).toBe(false);
  });

  it("never crosses another trace", () => {
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!.points;
        const b = all[j]!.points;
        for (let p = 1; p < a.length; p++)
          for (let q = 1; q < b.length; q++)
            expect(crossing(a[p - 1]!, a[p]!, b[q - 1]!, b[q]!), `${all[i]!.bundle} × ${all[j]!.bundle}`).toBeNull();
      }
  });

  it("keeps bundles apart (centre lines over 13 px) so each reads as its own", () => {
    const bundles = new Map<string, Trace[]>();
    for (const t of all) bundles.set(t.bundle, [...(bundles.get(t.bundle) ?? []), t]);
    const list = [...bundles.entries()];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        for (const a of list[i]![1])
          for (const b of list[j]![1]) expect(polyDist(a.points, b.points), `${list[i]![0]} ~ ${list[j]![0]}`).toBeGreaterThan(13);
  });

  it("plugs every part's bundle in where it leaves the part", () => {
    for (const name of TRACE_NAMES) expect(named[name].plug, name).not.toBeNull();
    const port = named.port0.plug!;
    const m = l.ports[0].module;
    expect(Math.abs(port.y - (m.y + m.h)) < 0.5 || Math.abs(port.x - (m.x + m.w)) < 0.5).toBe(true);
  });
});
