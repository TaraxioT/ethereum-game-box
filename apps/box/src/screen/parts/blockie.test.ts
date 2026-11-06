import { describe, expect, it } from "vitest";
import { blockie, blockieLedSvg } from "./blockie.ts";

const ADDRESS = "0x8ba1f109551bd432803012645ac136ddd64dba72";

describe("blockie", () => {
  it("draws the face the original ethereum-blockies draws for an address", () => {
    const b = blockie(ADDRESS);
    expect(b.color).toBe("hsl(27 62.6% 39.7%)");
    expect(b.bg).toBe("hsl(310 98.7% 35.7%)");
    expect(b.spot).toBe("hsl(18 88.6% 46%)");
    expect(b.cells.join("")).toBe("1110011120211202110110111211112110100101000220000021120010200201");
  });

  it("is deterministic and ignores the address's case", () => {
    expect(blockie(ADDRESS)).toEqual(blockie(ADDRESS));
    expect(blockie(ADDRESS.toUpperCase().replace("0X", "0x"))).toEqual(blockie(ADDRESS));
    expect(blockieLedSvg(ADDRESS, 40)).toBe(blockieLedSvg(ADDRESS, 40));
  });

  it("mirrors every row and uses only the three colours", () => {
    for (const address of [ADDRESS, "0x0000000000000000000000000000000000000001", "0xffffffffffffffffffffffffffffffffffffffff"]) {
      const { cells } = blockie(address);
      expect(cells).toHaveLength(64);
      for (let y = 0; y < 8; y++) {
        const row = cells.slice(y * 8, y * 8 + 8);
        expect(row).toEqual(row.slice().reverse());
      }
      expect(cells.every((c) => c === 0 || c === 1 || c === 2)).toBe(true);
    }
  });

  it("gives different addresses different faces", () => {
    expect(blockie("0x0000000000000000000000000000000000000001").cells).not.toEqual(blockie("0x0000000000000000000000000000000000000002").cells);
  });

  it("renders as an LED grid of the asked size, one LED per cell", () => {
    const leds = blockieLedSvg(ADDRESS, 40);
    expect(leds).toMatch(/^<svg [^>]*width="40" height="40" viewBox="0 0 8 8"/);
    expect(leds.match(/<rect /g)).toHaveLength(64);
    expect(leds.match(/class="c2"/g)).toHaveLength(blockie(ADDRESS).cells.filter((c) => c === 2).length);
  });
});
