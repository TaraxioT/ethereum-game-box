import { describe, expect, it } from "vitest";
import { LineScanner } from "./scanner.ts";

const scan = (scanner: LineScanner, ...chunks: string[]): string[] => {
  const lines: string[] = [];
  for (const chunk of chunks) scanner.push(Buffer.from(chunk), (l) => lines.push(l));
  return lines;
};

describe("LineScanner", () => {
  it("splits a chunk into its lines, dropping \\r and empty lines", () => {
    expect(scan(new LineScanner(), "a\nbb\r\n\nccc\n")).toEqual(["a", "bb", "ccc"]);
  });

  it("joins a line cut across chunks, however small the pieces", () => {
    const scanner = new LineScanner();
    expect(scan(scanner, '{"ev":', '"link"', ',"up":true}\n{"e')).toEqual(['{"ev":"link","up":true}']);
    expect(scan(scanner, 'v":"x"}\n')).toEqual(['{"ev":"x"}']);
  });

  it("copies the partial line, so a reused read buffer can't change it", () => {
    const scanner = new LineScanner();
    const pool = Buffer.from("abc");
    const lines: string[] = [];
    scanner.push(pool, (l) => lines.push(l));
    pool.write("xyz");
    scanner.push(Buffer.from("d\n"), (l) => lines.push(l));
    expect(lines).toEqual(["abcd"]);
  });

  it("drops a line that never ends, and counts it", () => {
    const scanner = new LineScanner();
    expect(scan(scanner, "x".repeat(3000), "y".repeat(3000), "tail\nok\n")).toEqual(["tail", "ok"]);
    expect(scanner.overlong).toBe(1);
  });

  it("forgets a partial line on reset (the port closed)", () => {
    const scanner = new LineScanner();
    scan(scanner, "half");
    scanner.reset();
    expect(scan(scanner, "whole\n")).toEqual(["whole"]);
  });
});
