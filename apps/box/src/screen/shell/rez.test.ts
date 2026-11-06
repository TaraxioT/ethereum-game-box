import { describe, expect, it } from "vitest";
import { DEREZ_MS, FLICKER, FLICKER_MS, REZ_MS, derezLine, derezNode, flickerBudget, rezLine, rezNode } from "./rez.ts";

const offsets = (frames: Keyframe[]): number[] => frames.map((f) => f.offset as number);
const opacity = (frames: Keyframe[]): number[] => frames.map((f) => f.opacity as number);

describe("rez", () => {
  it("takes 380 ms, plus one 90 ms flicker when allowed", () => {
    expect(REZ_MS).toBe(380);
    expect(rezNode(false).duration).toBe(380);
    expect(rezNode(true).duration).toBe(380 + FLICKER_MS);
    expect(rezLine().duration).toBe(380);
  });

  it("holds the node flat and dark while the line draws, then opens it", () => {
    const { frames, duration } = rezNode(false);
    expect(frames[0]).toMatchObject({ transform: "scaleY(0.02)", opacity: 0 });
    expect(frames[1]).toMatchObject({ transform: "scaleY(0.02)", opacity: 0 });
    expect((frames[1]?.offset as number) * duration).toBeCloseTo(120);
    expect(frames.at(-1)).toMatchObject({ transform: "none", opacity: 1, offset: 1 });
  });

  it("flickers once at the end, never below 0.4", () => {
    const { frames, duration } = rezNode(true);
    expect((frames[2]?.offset as number) * duration).toBeCloseTo(380);
    expect(opacity(frames).slice(2)).toEqual([1, 0.55, 1]);
    expect(Math.min(...opacity(FLICKER))).toBeGreaterThanOrEqual(0.4);
  });

  it("draws the line out from the centre in 120 ms, then lets it fade", () => {
    const { frames, duration } = rezLine();
    expect(frames.map((f) => f.transform)).toEqual(["scaleX(0)", "scaleX(1)", "scaleX(1)"]);
    expect((frames[1]?.offset as number) * duration).toBeCloseTo(120);
    expect(opacity(frames)).toEqual([1, 1, 0]);
  });

  it("keeps every keyframe offset in order", () => {
    for (const t of [rezNode(true), rezNode(false), rezLine(), derezNode(), derezLine()]) {
      const o = offsets(t.frames);
      expect(o).toEqual([...o].sort((a, b) => a - b));
      expect(o[0]).toBe(0);
      expect(o.at(-1)).toBe(1);
    }
  });
});

describe("derez", () => {
  it("folds the node flat in 220 ms of its 300, then hands over to the line", () => {
    expect(DEREZ_MS).toBe(300);
    const node = derezNode();
    expect(node.duration).toBe(300);
    expect((node.frames[1]?.offset as number) * 300).toBeCloseTo(220);
    expect(node.frames[1]).toMatchObject({ transform: "scaleY(0.02)", opacity: 1 });
    expect(node.frames.at(-1)).toMatchObject({ transform: "scaleY(0.02)", opacity: 0 });
    const line = derezLine();
    expect(line.frames[2]).toMatchObject({ opacity: 1, transform: "scaleX(1)" });
    expect(line.frames.at(-1)).toMatchObject({ opacity: 0, transform: "scaleX(0)" });
  });

  it("can run faster with the same shape", () => {
    expect(derezNode(120).duration).toBe(120);
    expect(offsets(derezNode(120).frames)).toEqual(offsets(derezNode().frames));
  });
});

describe("flicker budget", () => {
  it("allows three flickers a second and no more", () => {
    const b = flickerBudget();
    expect([0, 10, 20, 30].map((t) => b.take(t))).toEqual([true, true, true, false]);
    expect(b.take(999)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.take(1005)).toBe(false);
    expect(b.take(1020)).toBe(true);
  });
});
