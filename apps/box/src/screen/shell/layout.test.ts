import { describe, expect, it } from "vitest";
import { LANDSCAPE, PORTRAIT, WIDE, WIDE_INSET, layoutForArea, portBoxes, seatAt } from "./layout.ts";

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

  it("leaves two ports as they stand, and stacks more two to a corner in the same boxes", () => {
    for (const layout of [LANDSCAPE, WIDE, PORTRAIT]) {
      const [left, right] = layout.ports.map((p) => p.module);
      expect(portBoxes(layout, 2)).toEqual([left, right]);
      const four = portBoxes(layout, 4);
      expect(four).toHaveLength(4);
      expect(portBoxes(layout, 3)).toEqual(four.slice(0, 3));
      expect(four[0]).toEqual({ ...left, h: left!.h / 2 });
      expect(four[2]).toEqual({ ...left, y: left!.y + left!.h / 2, h: left!.h / 2 });
      expect(four[3]).toEqual({ ...right, y: right!.y + right!.h / 2, h: right!.h / 2 });
    }
  });

  it("taps by the half with two seats, and by the quarter with more", () => {
    const low = LANDSCAPE.height - 20;
    expect([seatAt(LANDSCAPE, 2, 100, 200), seatAt(LANDSCAPE, 2, 1000, low)]).toEqual([0, 1]);
    expect([seatAt(LANDSCAPE, 4, 100, 200), seatAt(LANDSCAPE, 4, 1000, 200), seatAt(LANDSCAPE, 4, 100, low), seatAt(LANDSCAPE, 4, 1000, low)]).toEqual([0, 1, 2, 3]);
    // With three, the lower right is still Player 2's.
    expect([seatAt(LANDSCAPE, 3, 100, low), seatAt(LANDSCAPE, 3, 1000, low)]).toEqual([2, 1]);
  });
});
