import { describe, expect, it } from "vitest";
import {
  bus,
  chamfer,
  clipCircle,
  crossing,
  exitRect,
  join,
  lengths,
  offset,
  pointAt,
  polyHitsRect,
  rng,
  route,
  simplify,
  slice,
} from "./route.ts";
import type { Point } from "./layout.ts";

/** Every segment's heading is a multiple of 45°. */
function only45(poly: readonly Point[]): boolean {
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (Math.abs(deg / 45 - Math.round(deg / 45)) > 0.01) return false;
  }
  return true;
}

describe("route", () => {
  it("runs straight then in at 45° along the longer axis", () => {
    expect(route({ x: 0, y: 0 }, { x: 100, y: 30 })).toEqual([
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 100, y: 30 },
    ]);
  });

  it("honours a lead, then diagonal, then straight", () => {
    const r = route({ x: 0, y: 0 }, { x: 100, y: 30 }, { lead: 20 });
    expect(r).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 50, y: 30 },
      { x: 100, y: 30 },
    ]);
  });

  it("leaves along the shorter axis when asked", () => {
    const r = route({ x: 0, y: 0 }, { x: 100, y: 30 }, { axis: "y", lead: 10 });
    expect(r).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 20, y: 30 },
      { x: 100, y: 30 },
    ]);
    expect(only45(r)).toBe(true);
  });

  it("is a single segment for straight and pure diagonal runs", () => {
    expect(route({ x: 0, y: 0 }, { x: 0, y: 50 })).toHaveLength(2);
    expect(route({ x: 0, y: 0 }, { x: -40, y: 40 })).toHaveLength(2);
  });
});

describe("join and simplify", () => {
  it("keeps shared joints once and merges straight runs", () => {
    expect(join([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 5 }])).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(simplify([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("chamfer", () => {
  it("cuts a right angle into two 45° bends and leaves 45° bends alone", () => {
    const c = chamfer([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 50 }], 10);
    expect(c).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 10, y: 50 },
      { x: 50, y: 50 },
    ]);
    const d = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 20, y: 70 }];
    expect(chamfer(d, 10)).toEqual(d);
  });
});

describe("offset and bus", () => {
  const centre = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 50 }, { x: 150, y: 120 }];

  it("keeps the pitch on every run, round 45° bends", () => {
    const [a, b] = bus(centre, 2, 10);
    for (let i = 1; i < centre.length; i++) {
      // Distance from a's segment to b's matching segment, measured along the centre segment's normal.
      const p = centre[i - 1]!;
      const q = centre[i]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const n = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
      const da = (a![i]!.x - p.x) * n.x + (a![i]!.y - p.y) * n.y;
      const db = (b![i]!.x - p.x) * n.x + (b![i]!.y - p.y) * n.y;
      expect(db - da).toBeCloseTo(10, 6);
    }
  });

  it("puts positive offsets to the right of travel (y down)", () => {
    expect(offset([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5)[0]).toEqual({ x: 0, y: 5 });
  });
});

describe("lengths, pointAt and slice", () => {
  const poly = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];

  it("measures cumulative length", () => {
    expect(lengths(poly)).toEqual([0, 30, 70]);
  });

  it("samples the point and heading a fraction of the way along", () => {
    const mid = pointAt(poly, 0.5);
    expect(mid.x).toBeCloseTo(30);
    expect(mid.y).toBeCloseTo(5);
    expect(mid.angle).toBeCloseTo(Math.PI / 2);
    expect(pointAt(poly, 0)).toMatchObject({ x: 0, y: 0 });
    expect(pointAt(poly, 2)).toMatchObject({ x: 30, y: 40 });
  });

  it("cuts a stretch out between two lengths, corners kept", () => {
    expect(slice(poly, lengths(poly), 20, 50)).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
    ]);
  });
});

describe("clipCircle", () => {
  it("ends the line where it first meets the circle", () => {
    const c = clipCircle([{ x: -100, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 0 }, 30);
    expect(c).toHaveLength(2);
    expect(c[1]!.x).toBeCloseTo(-30);
    expect(c[1]!.y).toBeCloseTo(0);
  });

  it("keeps a line that never meets it", () => {
    const line = [{ x: -100, y: 50 }, { x: 100, y: 50 }];
    expect(clipCircle(line, { x: 0, y: 0 }, 30)).toEqual(line);
  });
});

describe("hit tests", () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };

  it("finds a polyline passing through a rect, and one passing by", () => {
    expect(polyHitsRect([{ x: 0, y: 20 }, { x: 40, y: 20 }], r)).toBe(true);
    expect(polyHitsRect([{ x: 0, y: 40 }, { x: 40, y: 40 }], r)).toBe(false);
    expect(polyHitsRect([{ x: 0, y: 40 }, { x: 40, y: 40 }], r, 12)).toBe(true);
    expect(polyHitsRect([{ x: 0, y: 30 }, { x: 40, y: 30 }], r)).toBe(false);
  });

  it("finds where a polyline leaves a rect", () => {
    const e = exitRect([{ x: 20, y: 20 }, { x: 20, y: 60 }], r);
    expect(e?.x).toBeCloseTo(20);
    expect(e?.y).toBeCloseTo(30);
    expect(e?.angle).toBeCloseTo(Math.PI / 2);
  });

  it("finds crossings but not shared ends", () => {
    expect(crossing({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 5 });
    expect(crossing({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeNull();
  });
});

describe("rng", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const a = rng(7);
    const b = rng(7);
    const xs = Array.from({ length: 200 }, () => a());
    expect(xs).toEqual(Array.from({ length: 200 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(8)()).not.toBe(xs[0]);
  });
});
