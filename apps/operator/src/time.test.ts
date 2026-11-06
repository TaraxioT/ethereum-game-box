import { describe, expect, it } from "vitest";

import { relative, utc } from "./time.ts";

describe("relative", () => {
  it("says how far, and which way", () => {
    expect(relative(1_000 + 30, 1_000)).toBe("in 30 s");
    expect(relative(1_000 - 600, 1_000)).toBe("10 min ago");
    expect(relative(1_000 + 7_200, 1_000)).toBe("in 2 h");
    expect(relative(1_000 + 86_400, 1_000)).toBe("in 1 day");
    expect(relative(1_000 - 29 * 86_400, 1_000)).toBe("29 days ago");
  });

  it("writes UTC", () => {
    expect(utc(1_800_000_000)).toBe("2027-01-15 08:00 UTC");
  });
});
