// The Forge's shelf: every game whose game.json says `forge.template` is a starting point. Discovered by scanning the
// game roots it is given, never a fixed list, so a template is on the shelf as soon as its folder lands.
//
// A template's folder is a game in the module shape. Where its own rules.ts and screen.ts aren't a built game's (a
// team game's rules run in the core and its screen is a kiosk view), it carries its built form in `built/`: a whole
// built game's sources (rules.ts default-exporting BuiltRules, screen.ts default-exporting GameScreen, and any files
// they import), importing only each other and @egb/sdk. A build starts from `built/` plus the template's game.json,
// icon.svg and BLUEPRINT.md. A folder without `built/` is its own built form.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { manifestProblems, type GameManifest } from "@egb/sdk";

export interface ShelfTemplate {
  readonly id: string;
  readonly title: string;
  /** The Designer's words for it (`forge.label`). */
  readonly label: string;
  readonly default: boolean;
  /** The template's folder. */
  readonly dir: string;
  /** Where its built form's sources are: `dir/built`, or `dir` itself. */
  readonly sources: string;
}

/** The subfolder holding a team game's built form. */
export const BUILT_FORM = "built";

export function readManifestFile(dir: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(dir, "game.json"), "utf8"));
  } catch {
    return null;
  }
}

function template(dir: string): ShelfTemplate | null {
  const raw = readManifestFile(dir);
  if (manifestProblems(raw).length > 0) return null;
  const m = raw as GameManifest;
  if (m.forge?.template !== true || m.id !== path.basename(dir)) return null;
  const built = path.join(dir, BUILT_FORM);
  return {
    id: m.id,
    title: m.title,
    label: m.forge.label,
    default: m.forge.default === true,
    dir,
    sources: existsSync(built) && statSync(built).isDirectory() ? built : dir,
  };
}

/** The shelf: the default first, then by title. An id found under two roots keeps the first root's. */
export function readShelf(roots: readonly string[]): ShelfTemplate[] {
  const found = new Map<string, ShelfTemplate>();
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const t = template(path.join(root, name));
      if (t && !found.has(t.id)) found.set(t.id, t);
    }
  }
  return [...found.values()].sort((a, b) => Number(b.default) - Number(a.default) || a.title.localeCompare(b.title));
}
