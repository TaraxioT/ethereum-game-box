import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sdkPaths } from "../bundle/paths.ts";
import { MAX_GAME_FILES } from "./limits.ts";
import { readShelf } from "./shelf.ts";
import { brief, FIXTURES, tempDir } from "./test-helpers.ts";
import { finalizeManifest, manifestCheck, prepareWorkspace } from "./workspace.ts";

const sdk = sdkPaths();
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

/** A game root with the fixture, a team game carrying its built form in built/, and folders that aren't templates. */
function roots(): string {
  const root = tempDir("egb-shelf-");
  cpSync(path.join(FIXTURES, "tap-three"), path.join(root, "tap-three"), { recursive: true });
  const team = path.join(root, "duel");
  cpSync(path.join(FIXTURES, "tap-three"), path.join(team, "built"), { recursive: true });
  for (const f of ["game.json", "icon.svg", "BLUEPRINT.md"]) renameSync(path.join(team, "built", f), path.join(team, f));
  writeFileSync(path.join(team, "game.json"), JSON.stringify({ ...read(path.join(team, "game.json")), id: "duel", title: "Duel", forge: { template: true, label: "A duel" } }));
  writeFileSync(path.join(team, "screen.ts"), "// the team game's kiosk view: not a built game's screen\n");
  writeFileSync(path.join(team, "rules.test.ts"), "// a team test\n");
  mkdirSync(path.join(root, "plain"));
  writeFileSync(path.join(root, "plain/game.json"), JSON.stringify({ ...read(path.join(team, "game.json")), id: "plain", forge: undefined }));
  mkdirSync(path.join(root, "broken"));
  writeFileSync(path.join(root, "broken/game.json"), "{ not json");
  return root;
}

describe("the shelf", () => {
  it("is every game whose manifest says forge.template, the default first, from every root", () => {
    const root = roots();
    const shelf = readShelf([root, FIXTURES]);
    expect(shelf.map((t) => t.id)).toEqual(["tap-three", "duel"]);
    expect(shelf[0]).toMatchObject({ title: "Tap Three", label: "Race to three taps", default: true, dir: path.join(root, "tap-three"), sources: path.join(root, "tap-three") });
    expect(shelf[1]).toMatchObject({ default: false, sources: path.join(root, "duel", "built") });
    expect(readShelf([path.join(root, "missing")])).toEqual([]);
  });
});

describe("the work folder", () => {
  it("starts as the template's built form with the brief's id, title and stakes, and a locked reference", () => {
    const root = roots();
    const template = readShelf([root]).find((t) => t.id === "duel")!;
    const workDir = path.join(tempDir(), "work");
    prepareWorkspace({ workDir, template, gameId: "plank-dash-k2x9", brief: brief(), sdkSrc: sdk.src });
    // The built form's sources, not the team game's kiosk screen or its tests.
    expect(readFileSync(path.join(workDir, "screen.ts"), "utf8")).toMatch(/GameScreen accepts it/);
    expect(existsSync(path.join(workDir, "rules.test.ts"))).toBe(false);
    expect(existsSync(path.join(workDir, "built"))).toBe(false);
    expect(read(path.join(workDir, "game.json"))).toEqual({
      id: "plank-dash-k2x9", title: "Plank Dash", blurb: "First to tap their badge three times wins.", players: 2, minutes: 1,
      stakes: [2, 4], tier: "refereed", taps: "identify", kind: "built", budgetMs: 50,
    });
    for (const f of ["README.md", "parts.md", "sdk/rules.ts", "sdk/frame.ts", "sdk/screen.ts", "template/rules.ts", "template/BLUEPRINT.md", "template/game.json"]) {
      const p = path.join(workDir, ".reference", f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).mode & 0o222, f).toBe(0);
    }
    expect(existsSync(path.join(workDir, ".reference/sdk/random.test.ts"))).toBe(false);
    expect(manifestCheck(workDir, "plank-dash-k2x9")).toEqual([]);
  });

  it("checks game.json and the folder in words the agent can fix", () => {
    const workDir = path.join(tempDir(), "work");
    prepareWorkspace({ workDir, template: readShelf([FIXTURES])[0]!, gameId: "g-aaaa", brief: brief({ title: null, stakes: null }), sdkSrc: sdk.src });
    expect(read(path.join(workDir, "game.json"))).toMatchObject({ title: "Tap Three", stakes: [1, 5] });
    const write = (over: object) => writeFileSync(path.join(workDir, "game.json"), JSON.stringify({ ...read(path.join(workDir, "game.json")), ...over }));
    write({ id: "other", kind: "team", budgetMs: 900, blurb: "Provably fair tapping." });
    expect(manifestCheck(workDir, "g-aaaa")).toEqual([
      "game.json: budgetMs must be 1–200",
      'game.json: id must be "g-aaaa"',
      'game.json: kind must be "built"',
      "game.json: the Box referees this game, so its title and blurb can't claim it is verified, provable or proven",
    ]);
    writeFileSync(path.join(workDir, "game.json"), "{");
    expect(manifestCheck(workDir, "g-aaaa")).toEqual(["game.json is missing or isn't valid JSON"]);
  });

  it("caps the game's files and their sizes", () => {
    const workDir = path.join(tempDir(), "work");
    prepareWorkspace({ workDir, template: readShelf([FIXTURES])[0]!, gameId: "g-aaaa", brief: brief(), sdkSrc: sdk.src });
    mkdirSync(path.join(workDir, "parts"));
    for (let i = 0; i < MAX_GAME_FILES; i++) writeFileSync(path.join(workDir, "parts", `p${i}.ts`), "");
    writeFileSync(path.join(workDir, "big.json"), "x".repeat(200 * 1024));
    const problems = manifestCheck(workDir, "g-aaaa");
    expect(problems).toContainEqual(expect.stringMatching(/^the game has \d+ files: at most 40$/));
    expect(problems).toContain("big.json is 200 KB: at most 128 KB a file");
  });

  it("finalizes game.json: the Box's fields win, extras go", () => {
    const workDir = path.join(tempDir(), "work");
    prepareWorkspace({ workDir, template: readShelf([FIXTURES])[0]!, gameId: "g-aaaa", brief: brief(), sdkSrc: sdk.src });
    writeFileSync(path.join(workDir, "game.json"), JSON.stringify({ ...read(path.join(workDir, "game.json")), title: "Agent's Name", stakes: [100], players: 4, forge: { template: true }, blurb: "Walk the plank." }));
    expect(finalizeManifest(workDir, brief())).toMatchObject({ title: "Plank Dash", stakes: [2, 4], players: 2, blurb: "Walk the plank.", kind: "built" });
    expect(read(path.join(workDir, "game.json")).forge).toBeUndefined();
  });
});
