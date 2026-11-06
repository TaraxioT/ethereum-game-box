import { describe, expect, it } from "vitest";
import { cubicBezier } from "./bezier.ts";

describe("cubicBezier", () => {
  it("starts at 0 and ends at 1", () => {
    const ease = cubicBezier(0.25, 0.9, 0.3, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-0.5)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it("is the identity for the linear curve", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.25, 0.5, 0.8]) expect(linear(t)).toBeCloseTo(t, 5);
  });

  it("matches CSS's ease (cubic-bezier(0.25, 0.1, 0.25, 1)) at known points", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.25)).toBeCloseTo(0.4085, 3);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0.75)).toBeCloseTo(0.9605, 3);
  });

  it("rises without turning back on a steep ease-out", () => {
    const ease = cubicBezier(0.25, 0.9, 0.3, 1);
    let last = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      const v = ease(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
    expect(ease(0.2)).toBeGreaterThan(0.5);
  });
});
