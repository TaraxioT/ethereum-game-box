// The team games as the Forge's shelf: Quick Draw (the default) and Stock Duel, each starting a build from its
// built/ form. A fresh work folder from each must pass the Forge's whole build check (game.json, the type check, the
// bundle with its test match in the sandboxed child, the icon), exactly as a build would see it before the agent
// changes anything.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sdkPaths } from "../../builder/bundle/paths.ts";
import { createBuild } from "../../builder/forge/build.ts";
import { readShelf } from "../../builder/forge/shelf.ts";
import { brief, tempDir } from "../../builder/forge/test-helpers.ts";
import { prepareWorkspace } from "../../builder/forge/workspace.ts";

const GAMES = fileURLToPath(new URL("../../games", import.meta.url));

describe("the team games on the Forge's shelf", () => {
  const shelf = readShelf([GAMES]);

  it("are Quick Draw (the default) and Stock Duel, each from its built form", () => {
    expect(shelf.map((t) => [t.id, t.label, t.default])).toEqual([
      ["quick-draw", "Quick Draw", true],
      ["stock-duel", "Stock Duel", false],
    ]);
    for (const t of shelf) expect(t.sources).toBe(path.join(GAMES, t.id, "built"));
  });

  for (const template of shelf) {
    it(`${template.id}'s built form passes the build check as a fresh build starts`, async () => {
      const base = tempDir("egb-template-");
      const workDir = path.join(base, "work");
      const outDir = path.join(base, "out");
      const sdk = sdkPaths();
      prepareWorkspace({ workDir, template, gameId: "new-game-abcd", brief: brief({ template: template.id, title: "New Game" }), sdkSrc: sdk.src });
      const steps: string[] = [];
      const check = await createBuild({ workDir, outDir, gameId: "new-game-abcd", sdk, emit: (e) => e.type === "compile" && steps.push(`${e.step} ${e.ok ? "ok" : e.text}`) })();
      expect(check.errors).toEqual([]);
      expect(check.iconErrors).toEqual([]);
      expect(check.ok).toBe(true);
      expect(steps.sort()).toEqual(["bundle ok", "icon ok", "manifest ok", "typecheck ok"]);
    }, 120_000);
  }
});
