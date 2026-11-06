import { describe, expect, it } from "vitest";
import { reuse } from "./reuse.ts";

describe("reuse", () => {
  it("keeps the old object for an equal state", () => {
    const prev = { a: [1, { b: 2 }], c: null };
    expect(reuse(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev);
  });

  it("keeps every unchanged part and takes the changed ones", () => {
    const prev = { games: [{ id: "a" }, { id: "b" }], chain: { block: 1 }, seats: [{ n: 1 }, { n: 2 }] };
    const next = reuse(prev, { games: [{ id: "a" }, { id: "b" }], chain: { block: 2 }, seats: [{ n: 1 }, { n: 3 }] });
    expect(next).toEqual({ games: [{ id: "a" }, { id: "b" }], chain: { block: 2 }, seats: [{ n: 1 }, { n: 3 }] });
    expect(next).not.toBe(prev);
    expect(next.games).toBe(prev.games);
    expect(next.chain).not.toBe(prev.chain);
    expect(next.seats[0]).toBe(prev.seats[0]);
    expect(next.seats[1]).not.toBe(prev.seats[1]);
  });

  it("notices added, removed and retyped parts", () => {
    const prev: Record<string, unknown> = { a: 1, list: [1, 2], v: { x: 1 } };
    expect(reuse(prev, { a: 1, list: [1, 2] })).not.toBe(prev);
    expect(reuse(prev, { a: 1, list: [1, 2], v: { x: 1 }, w: 2 })).not.toBe(prev);
    expect(reuse(prev, { a: 1, list: [1, 2, 3], v: { x: 1 } }).list).toEqual([1, 2, 3]);
    expect(reuse(prev, { a: 1, list: [1, 2], v: null }).v).toBeNull();
    expect(reuse(prev, { a: 1, list: { 0: 1, 1: 2 }, v: { x: 1 } }).list).toEqual({ 0: 1, 1: 2 });
  });
});
