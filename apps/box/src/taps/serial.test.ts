// The tty writer against a descriptor that takes bytes when the test says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ttyWriter, type WriteSome } from "./serial.ts";

const eagain = (): never => {
  throw Object.assign(new Error("EAGAIN"), { code: "EAGAIN" });
};

/** A port whose kernel buffer has `room` bytes left (none: EAGAIN). */
function port() {
  const p = { room: Infinity, out: "", calls: 0 };
  const writeSome: WriteSome = (data, offset, length) => {
    p.calls++;
    if (p.room <= 0) eagain();
    const n = Math.min(length, p.room);
    p.room -= n;
    p.out += data.toString("latin1", offset, offset + n);
    return n;
  };
  return { p, writeSome };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ttyWriter", () => {
  it("waits out a full buffer and finishes the write", () => {
    const { p, writeSome } = port();
    const w = ttyWriter(writeSome, () => {});
    const done = vi.fn();
    p.room = 0;
    w.write(Buffer.from("state\n"), done);
    vi.advanceTimersByTime(10);
    expect(done).not.toHaveBeenCalled();
    p.room = Infinity;
    vi.advanceTimersByTime(50);
    expect(done).toHaveBeenCalledWith();
    expect(p.out).toBe("state\n");
  });

  it("backs off instead of spinning, gives up after a bound and counts the drop", () => {
    const { p, writeSome } = port();
    const drops = vi.fn();
    const w = ttyWriter(writeSome, drops);
    const done = vi.fn();
    p.room = 3;
    w.write(Buffer.from("press 7\n"), done);
    vi.advanceTimersByTime(2000);
    expect(p.calls).toBeLessThan(30);
    expect(drops).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith();
    // The torn line is ended before the next command, so the receiver doesn't read the two as one.
    p.room = Infinity;
    w.write(Buffer.from("state\n"), () => {});
    expect(p.out).toBe("pre\nstate\n");
  });

  it("stops retrying once the port closes: a reused descriptor is never written", () => {
    const { p, writeSome } = port();
    const w = ttyWriter(writeSome, () => {});
    p.room = 0;
    w.write(Buffer.from("state\n"), () => {});
    const calls = p.calls;
    w.close();
    p.room = Infinity;
    vi.advanceTimersByTime(1000);
    expect(p.calls).toBe(calls);
    const done = vi.fn();
    w.write(Buffer.from("state\n"), done);
    expect(done.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(p.out).toBe("");
  });
});
