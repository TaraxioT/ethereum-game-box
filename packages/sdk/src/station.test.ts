import { afterEach, describe, expect, it, vi } from "vitest";
import { printable } from "./station.ts";

describe("printable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws anything the station's font can't as ?, at most `max` characters", () => {
    expect(printable("GO", 40)).toBe("GO");
    expect(printable("naïve\nline", 40)).toBe("na?ve?line");
    expect(printable("x".repeat(50), 40)).toBe("x".repeat(40));
    expect(printable("é".repeat(50), 40)).toBe("?".repeat(40));
    expect(printable("😀", 40)).toBe("??"); // two UTF-16 units, each replaced one for one
  });

  it("reads only what it keeps: a store game picks the length, and the kiosk has one thread", () => {
    const replace = vi.spyOn(String.prototype, "replace");
    printable("é".repeat(1000), 40);
    expect(replace.mock.contexts.map((text) => (text as unknown as string).length)).toEqual([40]);
  });
});
