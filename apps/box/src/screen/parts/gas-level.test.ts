import { describe, expect, it } from "vitest";
import { SEGMENTS, litSegments } from "./gas-level.ts";

describe("litSegments", () => {
  it("lights none at 0 gwei and all 16 at 5", () => {
    expect(SEGMENTS).toBe(16);
    expect(litSegments(0)).toBe(0);
    expect(litSegments(5)).toBe(16);
  });

  it("lights in proportion between", () => {
    expect(litSegments(2.5)).toBe(8);
    expect(litSegments(1.8)).toBe(6);
    expect(litSegments(0.1)).toBe(0);
    expect(litSegments(0.2)).toBe(1);
  });

  it("holds at 16 over 5 gwei", () => {
    expect(litSegments(5.1)).toBe(16);
    expect(litSegments(400)).toBe(16);
  });

  it("lights none for negative or missing values", () => {
    expect(litSegments(-1)).toBe(0);
    expect(litSegments(Number.NaN)).toBe(0);
  });
});
