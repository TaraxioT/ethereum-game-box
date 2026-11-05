import { manifestProblems } from "@egb/sdk";
import { describe, expect, it } from "vitest";
import { isGameId, newGameId, slugOf } from "./slug.ts";

describe("game ids", () => {
  it("keep the design's meaningful words", () => {
    expect(slugOf("Plank Dash")).toBe("plank-dash");
    expect(slugOf("a two-player game where you tap when the colour matches yours")).toBe("tap-colour-matches-yours");
    expect(slugOf("Café Crème")).toBe("cafe-creme");
    expect(slugOf("🎮 the game")).toBe("game");
  });

  it("fit game.json's id rule with the suffix, however long the words", () => {
    const id = newGameId("supercalifragilistic expialidocious extraordinarily magnificent", () => false);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(isGameId(id)).toBe(true);
    expect(manifestProblems({ id }).filter((p) => p.startsWith("id"))).toEqual([]);
    expect(isGameId(newGameId("x".repeat(80), () => false))).toBe(true);
  });

  it("add a suffix and skip taken ids", () => {
    expect(newGameId("plank dash", () => false, () => 0)).toBe("plank-dash-aaaa");
    let n = 0;
    const id = newGameId("plank dash", (x) => x === "plank-dash-aaaa", () => (n++ < 4 ? 0 : 0.5));
    expect(id).toMatch(/^plank-dash-[a-z2-9]{4}$/);
    expect(id).not.toBe("plank-dash-aaaa");
    expect(() => newGameId("x", () => true)).toThrow(/free game id/);
  });

  it("isGameId", () => {
    expect(isGameId("tap-match-k3x9")).toBe(true);
    for (const bad of ["../etc", "Tap", "a--b", "", "-a", "a/b", "x".repeat(41)]) expect(isGameId(bad), bad).toBe(false);
  });
});
