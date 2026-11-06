import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address } from "./eth.ts";
import { badgeOf, Roster } from "./roster.ts";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const keys = (n: number) => ({ key1: addr(1000 + n), key2: addr(n) });
const when = new Date("2026-11-06T10:00:00Z");

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "egb-roster-"));
  return { dir, file: join(dir, "badges.json"), logs: [] as string[] };
}

describe("Roster", () => {
  it("knows a badge by UID (any case) once it has its keys, with a label for a name", () => {
    const { file } = temp();
    const roster = Roster.load(file, () => {});
    expect(roster.byUid("04a1")).toBeUndefined();
    const entry = roster.record("04a1", keys(1), when);
    expect(roster.byUid("04A1")).toBe(entry);
    expect(badgeOf(entry)).toEqual({ address: addr(1), name: "nova" });
  });

  it("gives each new badge the next label, and the same identity under a new UID keeps its own", () => {
    const roster = Roster.load(temp().file, () => {});
    expect(roster.record("04a1", keys(1), when).label).toBe("nova");
    expect(roster.record("04b1", keys(2), when).label).toBe("orbit");
    expect(roster.record("04c1", keys(1), when).label).toBe("nova");
    expect(roster.record("04a1", keys(1), when)).toBe(roster.byUid("04a1"));
  });

  it("runs out of words gracefully", () => {
    const roster = Roster.load(temp().file, () => {});
    let last = "";
    for (let i = 0; i < 26; i++) last = roster.record(`04${i}`, keys(i + 1), when).label;
    expect(last).toBe("orbit2");
  });

  it("persists atomically: a reload knows every badge, and no temp file is left", async () => {
    const { dir, file } = temp();
    const roster = Roster.load(file, () => {});
    roster.record("04a1", keys(1), when);
    roster.record("04b1", keys(2), when);
    await roster.flush();
    expect(readdirSync(dir)).toEqual(["badges.json"]);
    const again = Roster.load(file, () => {});
    expect(again.byUid("04B1")).toMatchObject({ key2: addr(2), label: "orbit", firstSeen: when.toISOString() });
    expect(JSON.parse(readFileSync(file, "utf8")).v).toBe(1);
  });

  it("sets a broken file aside and starts over", () => {
    const { dir, file, logs } = temp();
    writeFileSync(file, "{ not json");
    const roster = Roster.load(file, (l) => logs.push(l));
    expect(roster.entries()).toEqual([]);
    expect(readdirSync(dir)).toEqual(["badges.json.bad"]);
    expect(logs).toHaveLength(1);
  });
});
