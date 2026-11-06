// The countdowns and the expired state, on fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FOREVER } from "./registry.ts";
import { ago, countdown, nowSeconds } from "./time.ts";

describe("countdowns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a pop-up's 10 minutes down to expired", () => {
    const expiry = nowSeconds() + 600;
    expect(countdown(expiry, nowSeconds())).toEqual({ state: "running", text: "10:00", seconds: 600 });
    vi.advanceTimersByTime(137_000);
    expect(countdown(expiry, nowSeconds())).toMatchObject({ state: "running", text: "07:43" });
    vi.advanceTimersByTime(462_000);
    expect(countdown(expiry, nowSeconds())).toMatchObject({ state: "running", text: "00:01" });
    vi.advanceTimersByTime(1_000);
    expect(countdown(expiry, nowSeconds())).toEqual({ state: "expired" });
    vi.advanceTimersByTime(60_000);
    expect(countdown(expiry, nowSeconds())).toEqual({ state: "expired" });
  });

  it("shows hours under a day and days beyond", () => {
    const now = nowSeconds();
    expect(countdown(now + 3 * 3600 + 7 * 60 + 42, now)).toMatchObject({ text: "3:07:42" });
    expect(countdown(now + 29 * 86_400 + 14 * 3600 + 6 * 60 + 51, now)).toMatchObject({ text: "29d 14:06:51" });
  });

  it("never counts a forever name", () => {
    expect(countdown(FOREVER, nowSeconds())).toEqual({ state: "forever" });
  });

  it("refreshes a relative time", () => {
    const seen = nowSeconds();
    expect(ago(seen, nowSeconds())).toBe("just now");
    vi.advanceTimersByTime(12_000);
    expect(ago(seen, nowSeconds())).toBe("12 s ago");
    vi.advanceTimersByTime(4 * 60_000);
    expect(ago(seen, nowSeconds())).toBe("4 min ago");
  });
});
