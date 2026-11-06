import { describe, expect, it } from "vitest";
import { createClockOffset, OFFSET_WINDOW_MS } from "./offset.ts";

describe("the link's clock offset", () => {
  it("takes the least-delayed message as the truth", () => {
    const offset = createClockOffset();
    expect(offset.value()).toBe(0);
    // The Box is 5 s ahead; the messages took 30, 2 and 12 ms to arrive.
    offset.sample(105_000 - 30, 100_000);
    offset.sample(105_100 - 2, 100_100);
    offset.sample(105_200 - 12, 100_200);
    expect(offset.value()).toBe(4_998);
  });

  it("follows a clock that was stepped, once the old samples age out", () => {
    const offset = createClockOffset();
    offset.sample(10_000, 0);
    offset.sample(9_000, 1_000);
    expect(offset.value()).toBe(10_000);
    offset.sample(9_000 + OFFSET_WINDOW_MS + 1, OFFSET_WINDOW_MS + 1_001);
    expect(offset.value()).toBe(8_000);
  });

  it("keeps its estimate until a new connection's first sample", () => {
    const offset = createClockOffset();
    offset.sample(7_000, 1_000);
    offset.reset();
    expect(offset.value()).toBe(6_000);
    offset.sample(3_000, 2_000);
    expect(offset.value()).toBe(1_000);
  });
});
