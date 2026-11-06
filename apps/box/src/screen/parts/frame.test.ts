import { describe, expect, it } from "vitest";
import { bevelPath, chamferClip, framePoints, tickPath } from "./frame.ts";

describe("framePoints", () => {
  it("cuts the top left and bottom right by default, 1 px inside the box", () => {
    expect(framePoints(200, 72, 14)).toBe("15,1 199,1 199,57 185,71 1,71 1,15");
  });

  it("cuts the top right and bottom left for a cartridge", () => {
    expect(framePoints(176, 186, 16, "tr-bl")).toBe("1,1 159,1 175,17 175,185 17,185 1,169");
  });

  it("never cuts more than half the box", () => {
    expect(framePoints(20, 10, 14)).toBe("6,1 19,1 19,4 14,9 1,9 1,6");
  });

  it("moves an inner line in with its cut kept parallel", () => {
    // 5 px in, the 14 px cut shrinks by 4 × (2 − √2) ≈ 2.3 px so its diagonal stays 45° and 4 px from the frame's.
    expect(framePoints(200, 72, 14, "tl-br", 5)).toBe("16.7,5 195,5 195,55.3 183.3,67 5,67 5,16.7");
  });
});

describe("bevelPath", () => {
  it("traces the two cut edges", () => {
    expect(bevelPath(200, 72, 14)).toBe("M1 15L15 1M199 57L185 71");
    expect(bevelPath(176, 186, 16, "tr-bl")).toBe("M159 1L175 17M17 185L1 169");
  });
});

describe("tickPath", () => {
  it("ticks the two uncut corners", () => {
    expect(tickPath(100, 50)).toBe("M89 1H99V11M1 39V49H11");
    expect(tickPath(100, 50, "tr-bl")).toBe("M11 1H1V11M99 39V49H89");
  });
});

describe("chamferClip", () => {
  it("matches the frame's cut at any size", () => {
    expect(chamferClip(8)).toBe("polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)");
  });
});
