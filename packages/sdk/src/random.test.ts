import { describe, expect, it } from "vitest";
import { hash32, mulberry32, shuffle } from "./random.ts";

describe("mulberry32", () => {
  it("repeats for the same seed and differs between seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const run = (next: () => number) => Array.from({ length: 5 }, next);
    expect(run(a)).toEqual(run(b));
    expect(run(mulberry32(42))).not.toEqual(run(c));
  });

  it("stays inside [0, 1) and covers the range", () => {
    const next = mulberry32(1);
    const values = Array.from({ length: 2000 }, next);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(Math.min(...values)).toBeLessThan(0.05);
    expect(Math.max(...values)).toBeGreaterThan(0.95);
  });
});

describe("hash32", () => {
  it("is a stable uint32", () => {
    const h = hash32("seed", 7, 0);
    expect(h).toBe(hash32("seed", 7, 0));
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });

  it("separates parts and neighbouring inputs", () => {
    expect(hash32("ab", "c")).not.toBe(hash32("a", "bc"));
    expect(hash32(5, 0)).not.toBe(hash32(5, 1));
  });

  it("spreads over the four stat slots", () => {
    const counts = [0, 0, 0, 0];
    for (let seed = 0; seed < 4000; seed++) counts[hash32(seed, 0) % 4] = (counts[hash32(seed, 0) % 4] ?? 0) + 1;
    for (const count of counts) expect(count).toBeGreaterThan(800);
  });
});

describe("shuffle", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it("keeps every item exactly once and repeats per seed", () => {
    const a = shuffle(items, 9);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(shuffle(items, 9)).toEqual(a);
  });

  it("changes the order between seeds", () => {
    expect(shuffle(items, 1)).not.toEqual(shuffle(items, 2));
  });

  it("does not mutate its input", () => {
    const input = Object.freeze([...items]);
    expect(() => shuffle(input, 3)).not.toThrow();
    expect(input).toEqual(items);
  });
});
