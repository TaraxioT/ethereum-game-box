import { describe, expect, it } from "vitest";
import { mulberry32 } from "@egb/sdk";
import { DEMO_BADGES } from "./badges.ts";
import { LABELS, ownLabel, proposeLabel } from "./labels.ts";

/** The label rule `GameBoxNames` checks: 3 to 32 of a-z, 0-9 and -, no hyphen at either end. */
const LABEL = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

describe("labels", () => {
  it("proposes a badge's own label first: the demo's badges are nova, kite and juno", () => {
    expect(DEMO_BADGES.map((badge) => proposeLabel(badge, 0, 123))).toEqual(["nova", "kite", "juno"]);
    expect(ownLabel({ address: "0x0000000000000000000000000000000000000001", name: "orbit" })).toBe("orbit");
  });

  it("then a word with two digits, always a valid label", () => {
    const rnd = mulberry32(5);
    const seen = new Set<string>();
    for (let attempt = 1; attempt <= 500; attempt++) {
      const label = proposeLabel(DEMO_BADGES[0]!, attempt, Math.floor(rnd() * 2 ** 32) >>> 0);
      expect(label).toMatch(/^[a-z]+-\d\d$/);
      expect(label).toMatch(LABEL);
      seen.add(label);
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("keeps every word a valid label", () => {
    for (const word of LABELS) expect(word).toMatch(LABEL);
  });
});
