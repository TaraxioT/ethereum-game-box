// The bundler guard is part of the Forge's sandbox: generated code must not pull files from elsewhere on disk into
// its bundle (where the agent could read them back, or a game could show them).
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../forge/test-helpers.ts";
import { bundleGame } from "./bundle.ts";
import { BUNDLE_FILES, sdkPaths } from "./paths.ts";

const SCREEN = "export default { mount() { return { update() {} }; } };\n";
const RULES = `import { stationView } from "@egb/sdk";
export default { start: () => 0, step: (s: number) => s, outcome: () => null, stations: () => [stationView("P1", "", ""), stationView("P2", "", "")] };
`;

/** A game folder whose rules.ts begins with `imports`, beside a secrets folder outside it. */
function game(imports: string, files: Record<string, string> = {}) {
  const base = tempDir("egb-guard-");
  const dir = path.join(base, "game");
  mkdirSync(path.join(base, "secret"), { recursive: true });
  writeFileSync(path.join(base, "secret/creds.json"), '{"token":"SECRET-JSON"}');
  writeFileSync(path.join(base, "secret/env"), "KEY=SECRET-ENV");
  writeFileSync(path.join(base, "secret/lib.ts"), 'export const s = "SECRET-TS";');
  mkdirSync(dir);
  writeFileSync(path.join(dir, "rules.ts"), `${imports.replaceAll("$BASE", base)}\n${RULES}`);
  writeFileSync(path.join(dir, "screen.ts"), SCREEN);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return { base, dir, out: path.join(base, "out") };
}

async function build(g: { dir: string; out: string }) {
  const r = await bundleGame(g.dir, g.out, sdkPaths());
  const js = path.join(g.out, BUNDLE_FILES.rules);
  return { ...r, text: r.errors.join("\n"), js: existsSync(js) ? readFileSync(js, "utf8") : "" };
}

describe("the bundler guard", () => {
  it("refuses absolute paths, `..` and import attributes, and nothing leaks", async () => {
    const g = game(`import creds from "$BASE/secret/creds.json";
import env from "../secret/env" with { type: "text" };
import { s } from "../secret/lib.ts";
console.log(creds, env, s);`);
    const r = await build(g);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/creds\.json: a game may import only its own files/);
    expect(r.text).toMatch(/import attributes/);
    expect(r.text).toMatch(/lib\.ts is outside the game's folder/);
    // A failed build writes nothing at all.
    expect(existsSync(g.out)).toBe(false);
  });

  it("follows a symlink to where it really goes", async () => {
    const g = game('import x from "./link.json"; console.log(x);');
    symlinkSync(path.join(g.base, "secret/creds.json"), path.join(g.dir, "link.json"));
    const r = await build(g);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/link\.json is outside the game's folder/);
  });

  it("refuses Node modules, packages and other SDK paths", async () => {
    const r = await build(
      game(`import fs from "node:fs";
import cp from "child_process";
import left from "left-pad";
import { hash32 } from "@egb/sdk/src/random.ts";
console.log(fs, cp, left, hash32);`),
    );
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/node:fs: a game may import only its own files/);
    expect(r.text).toMatch(/child_process: a game may import only/);
    expect(r.text).toMatch(/left-pad: a game may import only/);
    expect(r.text).toMatch(/@egb\/sdk\/src\/random\.ts isn't exported/);
  });

  it("refuses odd file types even inside the game's folder, and a dynamic import that names one", async () => {
    const r = await build(
      game(`import notes from "./notes.txt";
import "./look.css";
import raw from "./data";
const later = import("./icon.svg");
console.log(notes, raw, later);`, { "notes.txt": "hello", "look.css": "a{}", data: "{}", "icon.svg": "<svg/>" }),
    );
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/\.txt can't be imported \(only \.ts, \.js, \.json\)/);
    expect(r.text).toMatch(/\.css can't be imported/);
    expect(r.text).toMatch(/a file without an extension can't be imported/);
    expect(r.text).toMatch(/\.svg can't be imported/);
  });

  it("the runner's own module is not the game's to import", async () => {
    const r = await build(game('import { serve } from "egb:runner"; console.log(serve);'));
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/egb:runner isn't something a game can import/);
  });

  it("bundles the game's own TypeScript, JavaScript and JSON with @egb/sdk and @egb/sdk/screen", async () => {
    const g = game(
      `import { hash32 } from "@egb/sdk";
import type { GameScreen } from "@egb/sdk/screen";
import deck from "./deck.json";
import { two } from "./more.ts";
import { three } from "./plain.js";
export const used: [number, number, number, number, GameScreen | null] = [hash32(deck.n), two, three, 0, null];`,
      { "deck.json": '{"n":1}', "more.ts": "export const two = 2;", "plain.js": "export const three = 3;" },
    );
    const r = await build(g);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // One file each: nothing left to import at run time.
    expect(r.js).not.toMatch(/^\s*import\s/m);
  });
});
