import { describe, expect, it } from "vitest";
import { fit } from "./stage.ts";
import { LANDSCAPE, PORTRAIT, orientationFor } from "./layout.ts";

describe("fit", () => {
  it("fills 1280×800 exactly", () => {
    expect(fit(LANDSCAPE, 1280, 800)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("scales up to 1920×1080 by height and centres", () => {
    const f = fit(LANDSCAPE, 1920, 1080);
    expect(f.scale).toBeCloseTo(1.35);
    expect(f.y).toBeCloseTo(0);
    expect(f.x).toBeCloseTo((1920 - 1280 * 1.35) / 2);
  });

  it("fits a phone in portrait by width", () => {
    const f = fit(PORTRAIT, 390, 600);
    expect(f.scale).toBeCloseTo(390 / 720);
    expect(f.x).toBeCloseTo(0);
  });
});

describe("orientationFor", () => {
  it("picks portrait only when clearly taller than wide", () => {
    expect(orientationFor(390, 844)).toBe("portrait");
    expect(orientationFor(1280, 800)).toBe("landscape");
    expect(orientationFor(800, 820)).toBe("landscape");
  });
});
