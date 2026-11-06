import { describe, expect, it } from "vitest";
import { stationView } from "@egb/sdk";
import { bigLine, drawText, faceLines, fit, glyph, OLED_H, OLED_W, smallLines, stationPixels, textWidth, wrap } from "./oled-font.ts";

const REQUIRED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!?.:-+×=/%$#";

function rowsOf(pixels: readonly (readonly [number, number])[]): number[] {
  return [...new Set(pixels.map(([, y]) => y))].sort((a, b) => a - b);
}

describe("glyphs", () => {
  it("has every required character, seven rows inside its width", () => {
    for (const ch of REQUIRED) {
      const g = glyph(ch);
      expect(g, ch).not.toEqual(glyph("€"));
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
    const pixels = drawText("WWWWWWWWWWWWWWWWWWWWWWWW", -4, OLED_H - 4, 2);
    expect(pixels.length).toBeGreaterThan(0);
    for (const [x, y] of pixels) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(OLED_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(OLED_H);
    }
  });

  it("fits a line by dropping its tail", () => {
    expect(fit("SHORT", OLED_W)).toBe("SHORT");
    expect(textWidth(fit("W".repeat(40), OLED_W))).toBeLessThanOrEqual(OLED_W);
  });

  it("wraps at spaces and breaks long words only when asked", () => {
    expect(wrap("TAP TO JOIN", 50, 1)).toEqual(["TAP TO", "JOIN"]);
    expect(wrap("W".repeat(20), OLED_W, 1)).toBeNull();
    const broken = wrap("W".repeat(20), OLED_W, 1, true);
    expect(broken).toHaveLength(2);
    for (const line of broken ?? []) expect(textWidth(line)).toBeLessThanOrEqual(OLED_W);
  });
});

describe("station layout", () => {
  it("sets a short big line at double size, and a long one at single size", () => {
    expect(bigLine("WIN")).toEqual({ scale: 2, text: "WIN" });
    expect(bigLine("SIGNED")).toEqual({ scale: 2, text: "SIGNED" });
    expect(bigLine("HOLD STILL")).toEqual({ scale: 1, text: "HOLD STILL" });
    expect(textWidth(bigLine("WWWWWWWWWW").text)).toBeLessThanOrEqual(OLED_W);
  });

  it("breaks the small line over two rows at most", () => {
    expect(smallLines("100 EGB")).toEqual(["100 EGB"]);
    expect(smallLines("AVG PRICE $1,287.49")).toEqual(["AVG PRICE", "$1,287.49"]);
    expect(smallLines("W".repeat(20)).length).toBeLessThanOrEqual(2);
  });

  it("puts the tag in a lit badge at the top left, the big line under it and the small line at the foot", () => {
    const tag = stationPixels(stationView("P1", "", ""));
    const big = rowsOf(stationPixels(stationView("", "GO!", "")));
    const small = rowsOf(stationPixels(stationView("", "", "10 EGB")));
    expect(Math.max(...tag.map(([x]) => x))).toBeLessThan(20);
    expect(Math.max(...tag.map(([, y]) => y))).toBeLessThan(9);
    expect(big[0]).toBeGreaterThanOrEqual(10);
    expect(big[big.length - 1]).toBeLessThan(24);
    expect(small[0]).toBeGreaterThanOrEqual(25);
    expect(small[small.length - 1]).toBeLessThan(OLED_H);
  });

  it("cuts the tag's letters out of its badge", () => {
    const lit = new Set(stationPixels(stationView("P1", "", "")).map(([x, y]) => `${x},${y}`));
    const ink = drawText("P1", 2, 1);
    expect(ink.length).toBeGreaterThan(0);
    for (const [x, y] of ink) expect(lit.has(`${x},${y}`)).toBe(false);
    expect(lit.has("0,0")).toBe(true);
  });

  it("centres a line", () => {
    const xs = stationPixels(stationView("", "GO!", "")).map(([x]) => x);
    const left = Math.min(...xs);
    const right = OLED_W - 1 - Math.max(...xs);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("shows a tap's faces: the Box's override, or the station's own words", () => {
    const view = stationView("P1", "TAP", "tap to play", { done: "DONE|NOVA", sign: "HOLD STILL|rolling" });
    expect(faceLines(view, "idle")).toEqual({ big: "TAP", small: "tap to play" });
    expect(faceLines(view, "done")).toEqual({ big: "DONE", small: "NOVA" });
    expect(faceLines(view, "sign")).toEqual({ big: "HOLD STILL", small: "rolling" });
    expect(faceLines(view, "hold")).toEqual({ big: "HOLD", small: "reading" });
    expect(faceLines(stationView("P1", "TAP", ""), "done")).toEqual({ big: "DONE", small: "" });
    expect(stationPixels(view, "done")).not.toEqual(stationPixels(view));
  });

  it("lights nothing for a blank view", () => {
    expect(stationPixels(stationView("", "", ""))).toEqual([]);
  });

  it("keeps every pixel on the panel", () => {
    for (const [x, y] of stationPixels(stationView("P2", "WWWWWWWWWW", "W".repeat(20)))) {
      expect(x >= 0 && x < OLED_W && y >= 0 && y < OLED_H).toBe(true);
    }
  });
});
