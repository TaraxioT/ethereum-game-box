import { describe, expect, it } from "vitest";
import { chamferClip, framePoints, tickPath } from "./frame.ts";

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
