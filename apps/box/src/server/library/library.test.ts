// The library against the real team games' folders and a temp $EGB_DATA/games of built games.
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEAM_GAMES } from "../../core/catalogue.ts";
import { tempDir } from "../../builder/forge/test-helpers.ts";
import { createLibrary, iconUrl } from "./library.ts";

const TEAM_DIR = fileURLToPath(new URL("../../games", import.meta.url));

interface Install {
  readonly manifest?: object | string;
  readonly dist?: boolean;
  /** Seconds since the epoch the Forge installed it. */
  readonly at?: number;
}

const manifest = (id: string, over: object = {}) => ({
  id,
  title: id.replace(/-/g, " ").toUpperCase(),
  blurb: "A test game.",
  players: 2,
  minutes: 2,
  stakes: [1, 5],
  tier: "refereed",
  taps: "identify",
  kind: "built",
  budgetMs: 40,
  ...over,
});

function install(gamesDir: string, id: string, o: Install = {}): string {
  const dir = path.join(gamesDir, id);
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  const m = o.manifest ?? manifest(id);
  writeFileSync(path.join(dir, "game.json"), typeof m === "string" ? m : JSON.stringify(m));
  writeFileSync(path.join(dir, "icon.svg"), "<svg/>");
  if (o.dist !== false) for (const f of ["rules.js", "screen.js"]) writeFileSync(path.join(dir, "dist", f), "");
  writeFileSync(path.join(dir, "forge.json"), "{}");
  if (o.at) utimesSync(path.join(dir, "forge.json"), o.at, o.at);
  return dir;
}

function setup() {
  const gamesDir = path.join(tempDir("egb-library-"), "games");
  const logs: string[] = [];
  const library = createLibrary({ teamDir: TEAM_DIR, gamesDir, log: (text) => logs.push(text) });
  let changes = 0;
  library.subscribe(() => changes++);
  return { gamesDir, library, logs, changes: () => changes };
}

describe("the library", () => {
  it("answers with the catalogue before its first scan, and the team games' game.json agree with it", async () => {
    const { library, changes } = setup();
    expect(library.games()).toBe(TEAM_GAMES);
    await library.rescan();
    await library.scanned;
    expect(library.games()).toEqual(TEAM_GAMES);
    expect(changes()).toBe(0);
    expect(library.entry("quick-draw")?.manifest).toMatchObject({ kind: "team", taps: "identify", forge: { template: true, label: "Quick Draw", default: true } });
    expect(library.entry("stock-duel")?.manifest).toMatchObject({ kind: "team", taps: "random", forge: { template: true, label: "Stock Duel" } });
    expect(library.entry("bet-on-x")).toMatchObject({ dir: null, problem: null, info: { ready: false } });
    expect(library.rules("quick-draw")).toBeNull();
  });

  it("adds installed built games after the team games, oldest first, and seals the ones it can't offer", async () => {
    const { gamesDir, library, logs, changes } = setup();
    const lantern = install(gamesDir, "lantern-race", { at: 2_000_000 });
    install(gamesDir, "plank-dash", { at: 1_000_000 });
    install(gamesDir, "no-bundle", { dist: false, at: 3_000_000 });
    install(gamesDir, "half-done", { manifest: manifest("half-done", { title: "Half Done", stakes: [] }), at: 4_000_000 });
    install(gamesDir, "junk", { manifest: "{ not json", at: 5_000_000 });
    install(gamesDir, "quick-draw", { at: 6_000_000 });
    await library.rescan();

    const built = library.games().filter((g) => g.kind === "built");
    expect(built.map((g) => [g.id, g.ready])).toEqual([
      ["plank-dash", true],
      ["lantern-race", true],
      ["no-bundle", false],
      ["half-done", false],
      ["junk", false],
    ]);
    expect(library.games().slice(0, TEAM_GAMES.length)).toEqual(TEAM_GAMES);
    expect(built[1]).toMatchObject({ title: "LANTERN RACE", minutes: 2, stakes: [1, 5], tier: "refereed", icon: expect.stringMatching(/^\/games\/lantern-race\/icon\.svg\?v=[0-9a-z]+$/) });
    expect(built[3]?.title).toBe("Half Done");
    expect(library.entry("no-bundle")?.problem).toBe("dist/rules.js is missing");
    expect(library.entry("quick-draw")).toMatchObject({ info: { kind: "team", ready: true } });
    expect(logs).toContain("library: junk is sealed: game.json is missing or isn't JSON");
    expect(logs).toContain(`library: ${path.join(gamesDir, "quick-draw")} is left out: a team game already uses its id`);
    expect(changes()).toBe(1);

    expect(library.rules("lantern-race")).toEqual({ rulesJs: path.join(lantern, "dist", "rules.js"), budgetMs: 40 });
    expect(library.rules("no-bundle")).toBeNull();

    // Nothing changed: no event, and no reason logged twice.
    const logged = logs.length;
    await library.rescan();
    expect(changes()).toBe(1);
    expect(logs.slice(logged)).toEqual([]);
  });

  it("seals a game whose bundle didn't load until its folder goes", async () => {
    const { gamesDir, library, changes } = setup();
    const dir = install(gamesDir, "lantern-race");
    await library.rescan();
    library.seal("lantern-race", "its rules exited (1) before loading");
    expect(library.entry("lantern-race")).toMatchObject({ info: { ready: false }, problem: "its rules exited (1) before loading" });
    expect(library.rules("lantern-race")).toBeNull();
    await library.rescan();
    expect(library.entry("lantern-race")?.info.ready).toBe(false);
    library.seal("quick-draw", "never");
    expect(library.entry("quick-draw")?.info.ready).toBe(true);
    expect(changes()).toBe(2);

    rmSync(dir, { recursive: true });
    await library.rescan();
    expect(library.entry("lantern-race")).toBeNull();
    install(gamesDir, "lantern-race");
    await library.rescan();
    expect(library.entry("lantern-race")?.info.ready).toBe(true);
  });

  it("runs one scan at a time and folds asks into one more", async () => {
    const { gamesDir, library } = setup();
    const first = library.rescan();
    install(gamesDir, "late-game");
    expect(library.rescan()).toBe(first);
    await first;
    expect(library.entry("late-game")?.info.ready).toBe(true);
  });

  it("names a cartridge's art by the file's time", () => {
    expect(iconUrl("tap-three", 1_700_000_000_000)).toBe("/games/tap-three/icon.svg?v=loyw3v28");
  });
});
