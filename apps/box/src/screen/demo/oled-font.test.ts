import { describe, expect, it } from "vitest";
import { bigLines, drawText, fit, glyph, hasGlyph, OLED_H, OLED_W, stationPixels, textWidth, wrap } from "./oled-font.ts";

const REQUIRED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!?.:-+×=/%$#";

function rowsOf(pixels: readonly (readonly [number, number])[]): number[] {
  return [...new Set(pixels.map(([, y]) => y))].sort((a, b) => a - b);
}

describe("glyphs", () => {
  it("has every required character, seven rows inside its width", () => {
    for (const ch of REQUIRED) {
      expect(hasGlyph(ch), ch).toBe(true);
      const g = glyph(ch);
      expect(g.rows).toHaveLength(7);
      expect(g.width).toBeGreaterThan(0);
      expect(g.width).toBeLessThanOrEqual(5);
      for (const row of g.rows) expect(row).toBeLessThan(1 << g.width);
      expect(g.rows.some((row) => row !== 0), ch).toBe(true);
    }
  });

  it("draws A as its bitmap", () => {
    expect(glyph("A").rows).toEqual([0b01110, 0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001]);
  });

  it("trims narrow marks to their ink", () => {
    expect(glyph("!").width).toBe(1);
    expect(glyph(".").width).toBe(2);
    expect(glyph("1").width).toBe(3);
    expect(glyph("W").width).toBe(5);
  });

  it("reads lower case as upper case and prints a box for a missing character", () => {
    expect(glyph("q")).toEqual(glyph("Q"));
    expect(hasGlyph("€")).toBe(false);
    expect(glyph("€").width).toBe(5);
    expect(glyph("€").rows[0]).toBe(0b11111);
  });
});

describe("text", () => {
  it("measures glyphs one pixel apart, scaled", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("A")).toBe(5);
    expect(textWidth("AB")).toBe(11);
    expect(textWidth("A B")).toBe(15);
    expect(textWidth("AB", 3)).toBe(33);
  });

  it("draws inside the panel and clips what falls off it", () => {
    const pixels = drawText("WWWWWWWWWWWWWWWWWWWWWWWW", -4, 60, 2);
    expect(pixels.length).toBeGreaterThan(0);
    for (const [x, y] of pixels) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(OLED_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(OLED_H);
    }
  });

  it("fits a line by dropping its tail", () => {
    expect(fit("SHORT", 128)).toBe("SHORT");
    expect(textWidth(fit("W".repeat(40), 128))).toBeLessThanOrEqual(128);
  });

  it("wraps at spaces and breaks long words only when asked", () => {
    expect(wrap("TAP TO JOIN", 50, 1)).toEqual(["TAP TO", "JOIN"]);
    expect(wrap("W".repeat(30), 128, 1)).toBeNull();
    const broken = wrap("W".repeat(30), 128, 1, true);
    expect(broken).toHaveLength(2);
    for (const line of broken ?? []) expect(textWidth(line)).toBeLessThanOrEqual(128);
  });
});

describe("station layout", () => {
  it("sets a short big line at triple size", () => {
    expect(bigLines("GO!")).toEqual({ scale: 3, lines: ["GO!"] });
  });

  it("steps down to double size, then two lines, then small type", () => {
    expect(bigLines("SIGNED")).toEqual({ scale: 3, lines: ["SIGNED"] });
    expect(bigLines("REFUNDED")).toEqual({ scale: 2, lines: ["REFUNDED"] });
    expect(bigLines("TAP TO JOIN")).toEqual({ scale: 2, lines: ["TAP TO JOIN"] });
    expect(bigLines("PLEASE TAP YOUR BADGE")).toEqual({ scale: 2, lines: ["PLEASE TAP", "YOUR BADGE"] });
    expect(bigLines("TAP YOUR BADGE ON THE STATION NOW").scale).toBe(1);
  });

  it("puts the top line in the yellow band, the big line in the middle and the bottom line last", () => {
    const top = rowsOf(stationPixels({ top: "PLAYER 1", big: "", bottom: "" }));
    const big = rowsOf(stationPixels({ top: "", big: "GO!", bottom: "" }));
    const bottom = rowsOf(stationPixels({ top: "", big: "", bottom: "10 EGB" }));
    expect(top[0]).toBeGreaterThanOrEqual(0);
    expect(top[top.length - 1]).toBeLessThan(16);
    expect(big[0]).toBeGreaterThan(16);
    expect(big[big.length - 1]).toBeLessThan(56);
    expect(bottom[0]).toBeGreaterThan(55);
    expect(bottom[bottom.length - 1]).toBeLessThan(OLED_H);
  });

  it("centres a line", () => {
    const xs = stationPixels({ top: "", big: "GO!", bottom: "" }).map(([x]) => x);
    const left = Math.min(...xs);
    const right = OLED_W - 1 - Math.max(...xs);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("lights nothing for a blank view", () => {
    expect(stationPixels({ top: "", big: "", bottom: "" })).toEqual([]);
  });
});
