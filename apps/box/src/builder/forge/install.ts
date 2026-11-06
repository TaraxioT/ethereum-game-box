// Where the Forge keeps things under $EGB_DATA, and how a finished game moves into the library and out again.
//
// An installed built game is one folder, $EGB_DATA/games/<id>/:
//   game.json      the manifest (kind "built")
//   rules.ts …     the game's sources, as the agent left them
//   screen.ts
//   icon.svg       checked, or the Box's plain one
//   BLUEPRINT.md
//   forge.json     how it was built: job, provider, model, template, brief, turns, cost
//   dist/rules.js  the rules child's whole program
//   dist/screen.js the frame's screen module
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { manifestProblems } from "@egb/sdk";
import { BUNDLE_FILES } from "../bundle/paths.ts";
import { readManifestFile } from "./shelf.ts";
import { isGameId } from "./slug.ts";
import { REFERENCE } from "./workspace.ts";

export const DIST = "dist";
export const PROVENANCE = "forge.json";

export interface ForgeDirs {
  /** Installed built games. */
  readonly games: string;
  /** One folder per job while it builds (the agent's cwd). */
  readonly work: string;
  /** One folder per job for its bundle while it builds, outside the agent's reach. */
  readonly out: string;
  /** Job records, for the list and replays after a restart. */
  readonly jobs: string;
}

export function forgeDirs(dataDir: string): ForgeDirs {
  return {
    games: path.join(dataDir, "games"),
    work: path.join(dataDir, "forge", "work"),
    out: path.join(dataDir, "forge", "out"),
    jobs: path.join(dataDir, "forge", "jobs"),
  };
}

/**
 * Moves a finished build into the library: the reference goes, the bundle becomes `dist/`, and the folder is renamed
 * to games/<id> in one step, so the library never sees half a game. Work, out and games share $EGB_DATA, so every
 * rename stays on one filesystem.
 */
export function installGame(o: { readonly workDir: string; readonly outDir: string; readonly gamesDir: string; readonly gameId: string; readonly provenance: object }): string {
  const target = path.join(o.gamesDir, o.gameId);
  if (existsSync(target)) throw new Error(`a game called ${o.gameId} is already installed`);
  rmSync(path.join(o.workDir, REFERENCE), { recursive: true, force: true });
  rmSync(path.join(o.workDir, DIST), { recursive: true, force: true });
  renameSync(o.outDir, path.join(o.workDir, DIST));
  writeFileSync(path.join(o.workDir, PROVENANCE), `${JSON.stringify(o.provenance, null, 2)}\n`);
  mkdirSync(o.gamesDir, { recursive: true });
  renameSync(o.workDir, target);
  return target;
}

/**
 * Why an installed built game can't be offered (the library shows it sealed), or an empty list. A bundle that later
 * fails to load in its rules child seals it too; that is the rules runner's to report.
 */
export function installedProblems(dir: string): string[] {
  const raw = readManifestFile(dir);
  const problems = manifestProblems(raw);
  if (problems.length === 0 && (raw as { kind?: unknown }).kind !== "built") problems.push("kind must be built");
  if (problems.length === 0 && (raw as { id?: unknown }).id !== path.basename(dir)) problems.push("the id isn't the folder's name");
  for (const file of Object.values(BUNDLE_FILES)) if (!existsSync(path.join(dir, DIST, file))) problems.push(`${DIST}/${file} is missing`);
  return problems;
}

/** Deletes an installed built game. Never anything else: the folder must hold a game.json that says `built`. */
export function removeGame(gamesDir: string, gameId: string): void {
  if (!isGameId(gameId)) throw new Error("not a game id");
  const dir = path.join(gamesDir, gameId);
  const raw = readManifestFile(dir) as { kind?: unknown } | null;
  if (!raw) throw new Error(`no built game called ${gameId}`);
  if (raw.kind !== "built") throw new Error(`${gameId} isn't a built game`);
  rmSync(dir, { recursive: true, force: true });
}
