import { describe, expect, it } from "vitest";
import { changedDigits } from "./digits.ts";

describe("changedDigits", () => {
  it("lines the two values up from the right", () => {
    expect(changedDigits("12,071,233", "12,071,234")).toEqual([false, false, false, false, false, false, false, false, false, true]);
    expect(changedDigits("99", "100")).toEqual([true, true, true]);
    expect(changedDigits("100", "90")).toEqual([true, false]);
  });

  it("marks everything new when there was nothing before", () => {
    expect(changedDigits("", "42")).toEqual([true, true]);
  });
});
