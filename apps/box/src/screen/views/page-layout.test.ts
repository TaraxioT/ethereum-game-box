import { describe, expect, it } from "vitest";
import { LANDSCAPE, PORTRAIT, WIDE, WIDE_INSET, type Rect } from "../shell/layout.ts";
import { pageLayout } from "./page-layout.ts";

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("a page's places", () => {
  it("are the same for two seats, on every stage, whichever two they are", () => {
    const two = pageLayout(LANDSCAPE);
    expect(two.seats).toEqual([{ x: 64, y: 180, w: 340, h: 330 }, { x: 876, y: 180, w: 340, h: 330 }]);
    expect(pageLayout(WIDE)).toEqual(two);
    expect(pageLayout(LANDSCAPE, [0, 2])).toEqual(two);
  });

  it("stand a seat on its own side, stacked, with a lone seat centred", () => {
    const four = pageLayout(LANDSCAPE, [0, 1, 2, 3]).seats;
    expect(four.map((r) => r.x)).toEqual([48, 932, 48, 932]);
    expect(four.map((r) => r.y)).toEqual([134, 134, 390, 390]);
    const three = pageLayout(LANDSCAPE, [0, 2, 3]).seats;
    expect(three.map((r) => [r.x, r.y])).toEqual([[48, 134], [48, 390], [932, 262]]);
  });

  it("stand round the core on the wide stage", () => {
    const wide = pageLayout(WIDE, [0, 1, 2]);
    const narrow = pageLayout(LANDSCAPE, [0, 1, 2]);
    expect(wide.seats.map((r) => r.x)).toEqual(narrow.seats.map((r) => r.x + WIDE_INSET));
    expect(wide.plate.x + wide.plate.w / 2).toBe(WIDE.core.centre.x);
    expect(wide.keys.x + wide.keys.w / 2).toBe(WIDE.core.centre.x);
  });

  it("keep three and four panels off each other, the plate and the keys, on every stage", () => {
    for (const layout of [LANDSCAPE, WIDE, PORTRAIT]) {
      const { seats, plate, keys } = pageLayout(layout, [0, 1, 2, 3]);
      seats.forEach((seat, i) => {
        for (const other of [...seats.slice(i + 1), plate, keys]) expect(overlap(seat, other)).toBe(false);
      });
    }
  });
});
