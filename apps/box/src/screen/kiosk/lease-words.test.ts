import { describe, expect, it } from "vitest";
import { clock, gbxWord, hourStops, hoursWord, timeOfDay } from "./lease-words.ts";

describe("lease words", () => {
  it("stops the slider within the lease's bounds, both ends included", () => {
    expect(hourStops(1, 720)).toEqual([1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720]);
    expect(hourStops(5, 30)).toEqual([5, 6, 8, 12, 24, 30]);
    expect(hourStops(2, 2)).toEqual([2]);
  });

  it("says a length in hours, days or weeks", () => {
    expect(hoursWord(1)).toBe("1 HOUR");
    expect(hoursWord(3)).toBe("3 HOURS");
    expect(hoursWord(48)).toBe("2 DAYS");
    expect(hoursWord(168)).toBe("1 WEEK");
    expect(hoursWord(720)).toBe("30 DAYS");
  });

  it("runs a clock, with days past a day", () => {
    expect(clock(10_781)).toBe("02:59:41");
    expect(clock(-4)).toBe("00:00:00");
    expect(clock(3 * 86_400 + 4 * 3_600)).toBe("3D 04:00:00");
  });

  it("groups GBX in thousands", () => {
    expect(gbxWord("999985000")).toBe("999,985,000 GBX");
    expect(gbxWord("300")).toBe("300 GBX");
    expect(gbxWord("1.256")).toBe("1.26 GBX");
  });

  it("says a time of day, with the date when it isn't today", () => {
    const today = new Date(2026, 10, 7, 9, 0);
    expect(timeOfDay(new Date(2026, 10, 7, 14, 32).getTime() / 1000, today)).toBe("14:32");
    expect(timeOfDay(new Date(2026, 10, 9, 8, 5).getTime() / 1000, today)).toBe("NOV 9 08:05");
  });
});
