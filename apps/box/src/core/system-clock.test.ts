// The hosts' clocks. Checked with the server's tsconfig (Node's timers), not the core's.
import { afterEach, describe, expect, it, vi } from "vitest";
import { monotonicClock, systemClock } from "./system-clock.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the hosts' clocks", () => {
  it("the server's starts at the wall time and never follows a step of the system clock", () => {
    const clock = monotonicClock();
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1_000);
    const before = clock.now();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() - 3_600_000);
    const after = clock.now();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after - before).toBeLessThan(1_000);
  });

  it("the demo's is the wall clock", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    expect(systemClock().now()).toBe(42);
  });
});
