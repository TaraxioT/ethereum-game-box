// The folder a build works in: a copy of the template's built form, game.json reset for the new game, and the
// read-only `.reference/` the agent learns the SDK from. Also game.json's checks and its final form at install.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { manifestProblems, type GameManifest } from "@egb/sdk";
import type { GameBrief } from "../types.ts";
import { MAX_GAME_FILES, MAX_SOURCE_BYTES } from "./limits.ts";
import { readManifestFile, type ShelfTemplate } from "./shelf.ts";

export const REFERENCE = ".reference";
/** The template files a build always starts with, from the template's own folder. */
const TOP_FILES = ["game.json", "icon.svg", "BLUEPRINT.md"] as const;
const PARTS_DOC = fileURLToPath(new URL("./reference/parts.md", import.meta.url));

/** Never copied from a template: build output, deps, dotfiles (agent settings, our reference), tests. */
function copyable(src: string): boolean {
  const name = path.basename(src);
  return !name.startsWith(".") && name !== "node_modules" && name !== "dist" && !name.endsWith(".test.ts");
}

/** Symlinks become the files they point at, so nothing in the copy leads out of it. */
function copyTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true, dereference: true, filter: (src) => src === from || copyable(src) });
}

/** The template's starting files into `dir`: its built form, then its game.json, icon and blueprint. */
function copyTemplate(template: ShelfTemplate, dir: string): void {
  mkdirSync(dir, { recursive: true });
  copyTree(template.sources, dir);
  if (template.sources === template.dir) return;
  for (const f of TOP_FILES) {
    const from = path.join(template.dir, f);
    if (existsSync(from)) cpSync(from, path.join(dir, f), { dereference: true });
  }
}

function lockTree(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    // Files only: a read-only folder would stop the Box removing the reference before install.
    if (statSync(p).isDirectory()) lockTree(p);
    else chmodSync(p, 0o444);
  }
}

/** `.reference/`: the SDK's sources, the template as it started, and the parts a screen may use. */
function writeReference(dir: string, template: ShelfTemplate, sdkSrc: string): void {
  const ref = path.join(dir, REFERENCE);
  mkdirSync(ref, { recursive: true });
  cpSync(sdkSrc, path.join(ref, "sdk"), { recursive: true, dereference: true, filter: (src) => src === sdkSrc || (copyable(src) && /\.ts$/.test(src)) });
  copyTemplate(template, path.join(ref, "template"));
  cpSync(PARTS_DOC, path.join(ref, "parts.md"));
  writeFileSync(
    path.join(ref, "README.md"),
    [
      "# Reference (read-only)",
      "",
      "- `sdk/`: @egb/sdk, the contract between the Box and a game. Read `rules.ts` (BuiltRules, BuiltEvent),",
      "  `station.ts` (StationView, stationView), `random.ts` (seeded randomness), `seat.ts`, `manifest.ts` (game.json),",
      "  `frame.ts` (what the screen is sent) and `screen.ts` (GameScreen). Import it as `@egb/sdk` and `@egb/sdk/screen`.",
      `- \`template/\`: ${template.title}, the game this folder started as: a complete, working built game.`,
      "  `template/BLUEPRINT.md` says how it plays.",
      "- `parts.md`: the Box's parts a screen may use by tag (`<egb-key>`, `<egb-plate>`, …).",
      "",
      "Your game is the folder above this one. Nothing in .reference/ can be changed.",
      "",
    ].join("\n"),
  );
  lockTree(ref);
}

/** game.json for a fresh copy: the new id, a built game, the brief's title and stakes; the shelf entry dropped. */
function resetManifest(dir: string, gameId: string, brief: GameBrief): void {
  const m = (readManifestFile(dir) ?? {}) as Partial<GameManifest>;
  writeManifest(dir, fixed({ ...m, id: gameId } as GameManifest, brief));
}

/** The fields the Box decides, over whatever the game.json says; only the manifest's own fields survive. */
function fixed(m: GameManifest, brief: GameBrief): GameManifest {
  return {
    id: m.id,
    title: brief.title?.trim() || m.title,
    blurb: m.blurb,
    players: 2,
    minutes: m.minutes,
    stakes: brief.stakes ?? m.stakes,
    tier: "refereed",
    taps: m.taps,
    kind: "built",
    budgetMs: m.budgetMs,
  };
}

function writeManifest(dir: string, m: GameManifest): void {
  writeFileSync(path.join(dir, "game.json"), `${JSON.stringify(m, null, 2)}\n`);
}

export interface PrepareOptions {
  readonly workDir: string;
  readonly template: ShelfTemplate;
  readonly gameId: string;
  readonly brief: GameBrief;
  /** @egb/sdk's sources, copied into the reference. */
  readonly sdkSrc: string;
}

/** Lays out a fresh folder for a build. */
export function prepareWorkspace(o: PrepareOptions): void {
  rmSync(o.workDir, { recursive: true, force: true });
  copyTemplate(o.template, o.workDir);
  resetManifest(o.workDir, o.gameId, o.brief);
  writeReference(o.workDir, o.template, o.sdkSrc);
}

/** A refereed game's copy may not claim what only a proof could. */
const CLAIMS_PROOF = /\b(provabl[ey]|verifiabl[ey]|verified|trustless|proven|on-?chain proof|provably fair)\b/i;

/** The game's own files (not the reference): every one, with its size. */
function gameFiles(dir: string): { rel: string; bytes: number }[] {
  const out: { rel: string; bytes: number }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === REFERENCE) continue;
      const p = path.join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push({ rel: path.relative(dir, p).split(path.sep).join("/"), bytes: s.size });
    }
  };
  walk(dir);
  return out;
}

/** What's wrong with game.json and the folder, in words the agent can fix. Empty when both are fine. */
export function manifestCheck(dir: string, gameId: string): string[] {
  const raw = readManifestFile(dir);
  if (raw === null) return ["game.json is missing or isn't valid JSON"];
  const problems = manifestProblems(raw).map((p) => `game.json: ${p}`);
  const m = raw as Record<string, unknown>;
  if (m.id !== gameId) problems.push(`game.json: id must be "${gameId}"`);
  if (m.kind !== "built") problems.push('game.json: kind must be "built"');
  const copy = [m.title, m.blurb].filter((s) => typeof s === "string").join(" ");
  if (CLAIMS_PROOF.test(copy)) problems.push("game.json: the Box referees this game, so its title and blurb can't claim it is verified, provable or proven");
  const files = gameFiles(dir);
  if (files.length > MAX_GAME_FILES) problems.push(`the game has ${files.length} files: at most ${MAX_GAME_FILES}`);
  for (const f of files) if (f.bytes > MAX_SOURCE_BYTES) problems.push(`${f.rel} is ${Math.ceil(f.bytes / 1024)} KB: at most ${MAX_SOURCE_BYTES / 1024} KB a file`);
  return problems;
}

/** game.json at install: the Box's fields win over the agent's. The build has already checked the rest. */
export function finalizeManifest(dir: string, brief: GameBrief): GameManifest {
  const m = fixed(readManifestFile(dir) as GameManifest, brief);
  writeManifest(dir, m);
  return m;
}
