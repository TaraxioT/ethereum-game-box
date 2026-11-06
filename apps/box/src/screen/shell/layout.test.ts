import { describe, expect, it } from "vitest";
import { LANDSCAPE, PORTRAIT, WIDE, WIDE_INSET, layoutForArea } from "./layout.ts";

describe("the layouts", () => {
  it("picks the wide stage for a 16:9 window, the landscape one for 16:10, portrait when tall", () => {
    expect(layoutForArea(1280, 720)).toBe(WIDE);
    expect(layoutForArea(1920, 1080)).toBe(WIDE);
    expect(layoutForArea(1280, 800)).toBe(LANDSCAPE);
    expect(layoutForArea(720, 1280)).toBe(PORTRAIT);
  });

  it("makes the wide stage 16:9 with every anchor moved to its middle", () => {
    expect(WIDE.width / WIDE.height).toBeCloseTo(16 / 9, 2);
    expect(WIDE.width).toBe(LANDSCAPE.width + 2 * WIDE_INSET);
    expect(WIDE.inset).toBe(WIDE_INSET);
    expect(WIDE.core.centre.x).toBe(WIDE.width / 2);
    expect(WIDE.rack.map((r) => r.x - WIDE_INSET)).toEqual(LANDSCAPE.rack.map((r) => r.x));
    expect(WIDE.ports[1].ring.x - WIDE_INSET).toBe(LANDSCAPE.ports[1].ring.x);
    for (const r of [WIDE.clock, WIDE.title, WIDE.play, WIDE.txbar, ...WIDE.rack]) expect(r.x + r.w).toBeLessThanOrEqual(WIDE.width);
  });
});
