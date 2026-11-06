// The rules child's memory guard: /proc's VmRSS read right, the cap enforced once, reads never stacked. The real
// kill (a gigabyte of typed arrays) is sandbox.test.ts's, on Linux.
import { describe, expect, it, vi } from "vitest";
import { canGuardMemory, guardMemory, MEMORY_CAP_BYTES, readResident, residentBytes } from "./memory.ts";

const MB = 2 ** 20;

describe("the memory guard", () => {
  it("reads VmRSS from /proc/<pid>/status", async () => {
    expect(residentBytes("Name:\tnode\nVmPeak:\t 1048576 kB\nVmRSS:\t   41236 kB\nRssAnon:\t 20000 kB\n")).toBe(41_236 * 1024);
    expect(residentBytes("Name:\tnode\nState:\tZ (zombie)\n")).toBeNull();
    if (canGuardMemory()) expect(await readResident(process.pid)).toBeGreaterThan(10 * MB);
    else expect(await readResident(process.pid)).toBeNull();
  });

  it("calls a child over the cap once, and stops watching", async () => {
    const sizes = [40 * MB, 120 * MB, MEMORY_CAP_BYTES + MB, MEMORY_CAP_BYTES + 2 * MB];
    const read = vi.fn(async () => sizes.shift() ?? null);
    const over = vi.fn();
    guardMemory(1234, { read, over, everyMs: 1 });
    await vi.waitFor(() => expect(over).toHaveBeenCalledTimes(1));
    expect(over).toHaveBeenCalledWith(MEMORY_CAP_BYTES + MB);
    const reads = read.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(read.mock.calls.length).toBe(reads);
    expect(read).toHaveBeenCalledWith(1234);
  });

  it("never stacks a read behind a slow one, and stops when told", async () => {
    let release = (_bytes: number | null) => {};
    const read = vi.fn(() => new Promise<number | null>((resolve) => (release = resolve)));
    const over = vi.fn();
    const guard = guardMemory(1, { read, over, everyMs: 1, capBytes: 100 });
    await new Promise((r) => setTimeout(r, 20));
    expect(read).toHaveBeenCalledTimes(1);
    guard.stop();
    release(1_000);
    await new Promise((r) => setTimeout(r, 5));
    expect(over).not.toHaveBeenCalled();
  });
});
