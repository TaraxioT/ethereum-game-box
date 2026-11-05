import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../games/random.ts";
import { ANCHOR_AT, ANCHOR_BLOCK, BLOCK_MS, blockAt, GAS_MAX, GAS_MIN, GAS_STEP, nextBlockAt, nextGas } from "./chain.ts";

describe("blockAt", () => {
  it("counts from Sepolia's real height", () => {
    expect(blockAt(ANCHOR_AT)).toEqual({ block: ANCHOR_BLOCK, at: ANCHOR_AT });
    expect(blockAt(ANCHOR_AT + BLOCK_MS - 1).block).toBe(ANCHOR_BLOCK);
    expect(blockAt(ANCHOR_AT + BLOCK_MS)).toEqual({ block: ANCHOR_BLOCK + 1, at: ANCHOR_AT + BLOCK_MS });
  });

  it("puts a block every 12 s on the head two days on", () => {
    const now = Date.parse("2026-11-06T21:35:59Z") + 5_000;
    expect(blockAt(now).block).toBe(ANCHOR_BLOCK + (2 * 24 * 3600) / 12);
    expect(nextBlockAt(now)).toBe(blockAt(now).at + BLOCK_MS);
  });
});

describe("nextGas", () => {
  it("wanders inside the band in small steps", () => {
    const rnd = mulberry32(42);
    let gwei = 2;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < 20_000; i++) {
      const next = nextGas(gwei, rnd);
      expect(next).toBeGreaterThanOrEqual(GAS_MIN);
      expect(next).toBeLessThanOrEqual(GAS_MAX);
      expect(Math.abs(next - gwei)).toBeLessThanOrEqual(GAS_STEP + 0.005);
      expect(Math.round(next * 100) / 100).toBe(next);
      low = Math.min(low, next);
      high = Math.max(high, next);
      gwei = next;
    }
    expect(low).toBe(GAS_MIN);
    expect(high).toBe(GAS_MAX);
  });
});
