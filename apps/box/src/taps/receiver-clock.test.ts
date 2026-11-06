import { describe, expect, it } from "vitest";
import type { ReceiverEvent } from "./lines.ts";
import { ReceiverClock, TAP_RESEND_US } from "./receiver-clock.ts";

const WRAP = 2 ** 32;

type TapLine = Extract<ReceiverEvent, { ev: "tap" }>;
const tap = (at_us: number, extra: Partial<TapLine> = {}): TapLine => ({
  ev: "tap", st: "e4ba70", id: 1, uid: "04A1", atqa: "0044", sak: "20", ats: "", read_us: 27_400, gap_us: 20_000, tries: 1, at_us, ...extra,
});

describe("ReceiverClock", () => {
  it("maps at_us with the fastest line's offset", () => {
    const c = new ReceiverClock();
    c.observe(1_000_000, 10_005); // took 5 ms to arrive
    c.observe(2_000_000, 11_001); // took 1 ms: the better sample
    c.observe(3_000_000, 12_009);
    expect(c.toPi(3_000_000)).toBeCloseTo(12_001, 0);
  });

  it("follows at_us across the u32 wrap", () => {
    const c = new ReceiverClock();
    const before = WRAP - 500_000; // 0.5 s before the wrap
    c.observe(before, 50_000);
    c.observe(500_000, 51_000); // 1 s later, after the wrap
    expect(c.toPi(500_000)).toBeCloseTo(51_000, 3);
    expect(c.toPi(before)).toBeCloseTo(50_000, 3);
    // A line from just before the wrap, arriving late, is older, not 71 minutes newer.
    expect(c.toPi(WRAP - 100_000)).toBeCloseTo(50_400, 3);
  });

  it("ages the minimum, so drift between the clocks can't freeze it", () => {
    const c = new ReceiverClock();
    c.observe(0, 1000);
    // An hour on, the receiver's clock runs 20 ms slow: every sample now says +20 ms.
    c.observe(3_600_000_000, 1000 + 3_600_000 + 20);
    expect(c.toPi(3_600_000_000)).toBeCloseTo(1000 + 3_600_000 + 20, 3);
  });

  it("resyncs when the receiver's clock jumps back (a reboot), and resets", () => {
    const c = new ReceiverClock();
    c.observe(3_000_000_000, 10_000);
    c.observe(1_000, 20_000); // rebooted: 1 ms since boot
    expect(c.toPi(2_000)).toBeCloseTo(20_001, 3);
    c.reset();
    expect(c.toPi(5)).toBeNaN();
  });

  it("takes the touch from the line: radio, resends, the read and half the gap before it", () => {
    const c = new ReceiverClock();
    const line = tap(10_000_000);
    c.observe(line.at_us, 1_000_000);
    expect(c.touchedAt(line, 1500, 1_000_000)).toBeCloseTo(1_000_000 - 1.5 - 27.4 - 10, 6);
    const resent = tap(10_000_000, { tries: 3 });
    expect(c.touchedAt(resent, 1500, 1_000_000)).toBeCloseTo(1_000_000 - 1.5 - (2 * TAP_RESEND_US) / 1000 - 27.4 - 10, 6);
  });

  it("is never later than the line's arrival, and falls back to it before any sample", () => {
    const c = new ReceiverClock();
    expect(c.touchedAt(tap(5), 1500, 777)).toBe(777);
    c.observe(0, 1000);
    expect(c.touchedAt(tap(500_000_000, { read_us: 0, gap_us: 0 }), 0, 1000)).toBe(1000);
  });
});
