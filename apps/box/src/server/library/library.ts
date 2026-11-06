// The game library: the core's LibraryPort on the Pi. The team games come from apps/box/src/games/<id>/game.json, in
// the catalogue's rack order (the catalogue's sealed games, Bet on X and B17, have no folder and stay as it lists
// them); the built games from $EGB_DATA/games/<id>/, oldest first, so a new cartridge slides in at the end of the rack;
// and last the store's games, from its index (store-index.ts), for as long as it can be read.
//
// - It answers at once with the catalogue's team games: the server listens first and scans after, so the kiosk never
//   waits on a slow disk. `rescan()` runs the scan; the server calls it after listening and on the Forge's
//   onLibraryChange. One scan runs at a time; asks during a scan fold into one more after it.
// - A built game that can't be offered (installedProblems: a bad manifest, a missing bundle) is listed sealed, and its
//   reason is logged once. So is one whose bundle didn't load in its rules child (`seal`, from the rules host), until
//   the folder goes.
// - A store game's bundle is fetched at Join (bundles.ts), and one that fails is sealed the same way, until the game
//   leaves the rack. It can't take a team or a built game's id: it is left out.
// - Listeners hear only real changes to the list.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { manifestProblems, SEATS, type GameManifest } from "@egb/sdk";
import { TEAM_GAMES } from "../../core/catalogue.ts";
import type { LibraryPort } from "../../core/ports.ts";
import type { GameInfo } from "../../core/types.ts";
import { DIST, installedProblems, PROVENANCE } from "../../builder/forge/install.ts";
import { readManifestFile } from "../../builder/forge/shelf.ts";
import { BUNDLE_FILES } from "../../builder/bundle/paths.ts";
import { FALLBACK_ICON } from "../games/routes.ts";
import type { RulesGame } from "../rules/host.ts";
import type { StoreIndex, StoreListing } from "./store-index.ts";

export interface LibraryEntry {
  readonly info: GameInfo;
  /** The game's folder; null for a catalogue game that has none yet. */
  readonly dir: string | null;
  /** The checked manifest; null when game.json is missing or fails its check. */
  readonly manifest: GameManifest | null;
  /** Why it can't be played, or null. */
  readonly problem: string | null;
}

export interface Library extends LibraryPort {
  /** Scans both folders again. Resolves when the list is current. */
  rescan(): Promise<void>;
  /** Resolves once the first scan has finished. */
  readonly scanned: Promise<void>;
  entry(id: string): LibraryEntry | null;
  /** The rules host's `locate`: a playable built game's rules.js and budget. */
  rules(id: string): RulesGame | null;
  /**
   * Seals a built game whose bundle didn't load (the rules host's `onUnloadable`) or a store game whose bundle failed.
   * `passing`: the next scan lifts it.
   */
  seal(id: string, reason: string, passing?: boolean): void;
}

export interface LibraryOptions {
  /** The team games' folders: apps/box/src/games. */
  readonly teamDir: string;
  /** Installed built games: $EGB_DATA/games. */
  readonly gamesDir: string;
  readonly log: (text: string) => void;
  /** What the store offers. Absent: this Box has no store games. */
  readonly store?: StoreIndex | null;
}

/** The URL a built game's cartridge art is served at; `v` changes when the file does, so the kiosk never shows a stale one. */
export const iconUrl = (id: string, version: number): string => `/games/${id}/icon.svg?v=${Math.round(version).toString(36)}`;

/** The list as text with each game's fields in one order, so the same games compare equal however they were built. */
const listKey = (games: readonly GameInfo[]): string => JSON.stringify(games.map((g) => Object.entries(g).sort(([a], [b]) => a.localeCompare(b))));

const catalogueEntry = (info: GameInfo): LibraryEntry => ({ info, dir: null, manifest: null, problem: null });

/** game.json, checked; with `kind` it must also be that kind and name its own folder. */
function checkedManifest(dir: string, kind: GameManifest["kind"]): { manifest: GameManifest | null; problem: string | null; raw: unknown } {
  const raw = readManifestFile(dir);
  if (raw === null) return { manifest: null, problem: "game.json is missing or isn't JSON", raw };
  const problems = manifestProblems(raw);
  const m = raw as GameManifest;
  if (problems.length === 0 && m.kind !== kind) problems.push(`kind must be ${kind}`);
  if (problems.length === 0 && m.id !== path.basename(dir)) problems.push("the id isn't the folder's name");
  return problems.length === 0 ? { manifest: m, problem: null, raw } : { manifest: null, problem: problems.join("; "), raw };
}

function infoOf(id: string, m: GameManifest, kind: GameInfo["kind"], icon: string | null, sealed: string | null): GameInfo {
  return { id, kind, title: m.title, players: m.players, minutes: m.minutes, stakes: m.stakes, tier: m.tier, ready: sealed === null, sealed, icon, manifest: m };
}

/** A team game from its game.json; one without a folder (a sealed game in the catalogue) stays as the catalogue lists it. */
function teamEntry(teamDir: string, listed: GameInfo): LibraryEntry {
  const dir = path.join(teamDir, listed.id);
  if (readManifestFile(dir) === null) return catalogueEntry(listed);
  const { manifest, problem } = checkedManifest(dir, "team");
  if (!manifest) return { info: { ...listed, ready: false, sealed: problem }, dir, manifest: null, problem };
  return { info: infoOf(listed.id, manifest, "team", null, null), dir, manifest, problem: null };
}

/** A built game as the rack shows it; a broken one still shows its own title when game.json has one. */
async function builtEntry(dir: string, sealed: ReadonlyMap<string, string>): Promise<LibraryEntry & { readonly at: number }> {
  const id = path.basename(dir);
  const checked = checkedManifest(dir, "built");
  const { manifest, raw } = checked;
  const problem = checked.problem ?? installedProblems(dir)[0] ?? sealed.get(id) ?? null;
  const iconAt = (await stat(path.join(dir, "icon.svg")).catch(() => null))?.mtimeMs ?? 0;
  // Installed at: when the Forge wrote forge.json, else when the folder last changed.
  const at = ((await stat(path.join(dir, PROVENANCE)).catch(() => null)) ?? (await stat(dir).catch(() => null)))?.mtimeMs ?? 0;
  if (manifest) return { info: infoOf(id, manifest, "built", iconUrl(id, iconAt), problem), dir, manifest, problem, at };
  const named = (raw as { title?: unknown } | null)?.title;
  const title = typeof named === "string" && named.trim() ? named.slice(0, 24) : id;
  const info: GameInfo = { id, kind: "built", title, players: 2, minutes: 1, stakes: [1], tier: "refereed", ready: false, sealed: problem, icon: iconUrl(id, iconAt), manifest: null };
  return { info, dir, manifest: null, problem, at };
}

/** A store game as the rack shows it: no folder and no manifest until its bundle is fetched for a match. */
function storeEntry(listing: StoreListing, sealed: ReadonlyMap<string, string>): LibraryEntry {
  const { id, title, stakes, hash, players } = listing;
  const problem = sealed.get(id) ?? (players.min > SEATS.length ? `it needs ${players.min} players, and this Box seats ${SEATS.length}` : null);
  const info: GameInfo = { id, kind: "store", title, players: SEATS.length, minutes: 0, stakes, tier: "judged", ready: problem === null, sealed: problem, icon: FALLBACK_ICON, manifest: null, bundle: hash };
  return { info, dir: null, manifest: null, problem };
}

async function builtEntries(gamesDir: string, sealed: ReadonlyMap<string, string>): Promise<LibraryEntry[]> {
  const names = await readdir(gamesDir, { withFileTypes: true }).catch(() => []);
  const dirs = names.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_")).map((d) => path.join(gamesDir, d.name));
  const entries = await Promise.all(dirs.map((dir) => builtEntry(dir, sealed)));
  return entries.sort((a, b) => a.at - b.at || a.info.id.localeCompare(b.info.id)).map(({ at: _at, ...entry }) => entry);
}

export function createLibrary(options: LibraryOptions): Library {
  let entries: readonly LibraryEntry[] = TEAM_GAMES.map(catalogueEntry);
  let games: readonly GameInfo[] = TEAM_GAMES;
  let snapshot = listKey(games);
  const listeners = new Set<() => void>();
  const sealed = new Map<string, string>();
  /** Seals the next scan lifts. */
  const passing = new Set<string>();
  const reported = new Map<string, string>();
  let running: Promise<void> | null = null;
  let again = false;
  let markScanned!: () => void;
  const scanned = new Promise<void>((resolve) => (markScanned = resolve));

  /** Logs each line once, when it first shows or changes; `lines` is every folder's current problem, by folder. */
  function report(lines: ReadonlyMap<string, string>): void {
    for (const [key, line] of lines) if (reported.get(key) !== line) options.log(`library: ${line}`);
    reported.clear();
    for (const [key, line] of lines) reported.set(key, line);
  }

  const problems = (list: readonly LibraryEntry[]): [string, string][] =>
    list.flatMap((e) => (e.problem ? [[e.dir ?? e.info.id, `${e.info.id} is sealed: ${e.problem}`] as [string, string]] : []));

  /** Built and store games left out of the list, with why: logged alongside the sealed ones. */
  let leftOut: readonly [string, string][] = [];

  function publish(next: readonly LibraryEntry[]): void {
    entries = next;
    games = next.map((e) => e.info);
    report(new Map([...problems(next), ...leftOut]));
    const text = listKey(games);
    if (text === snapshot) return;
    snapshot = text;
    for (const listener of listeners) listener();
  }

  async function scan(): Promise<void> {
    const team = TEAM_GAMES.map((listed) => teamEntry(options.teamDir, listed));
    const teamIds = new Set(team.map((e) => e.info.id));
    const found = await builtEntries(options.gamesDir, sealed);
    // A built game can't take a team game's id: its cartridge, its routes and its matches would be the team game's.
    const built = found.filter((e) => !teamIds.has(e.info.id));
    leftOut = found.flatMap((e) => (teamIds.has(e.info.id) && e.dir ? [[e.dir, `${e.dir} is left out: a team game already uses its id`] as [string, string]] : []));
    const taken = new Set([...teamIds, ...built.map((e) => e.info.id)]);
    const listed = options.store?.listings() ?? [];
    for (const id of passing) sealed.delete(id);
    passing.clear();
    const store = listed.filter((l) => !taken.has(l.id)).map((l) => storeEntry(l, sealed));
    leftOut = [...leftOut, ...listed.flatMap((l) => (taken.has(l.id) ? [[l.hash, `the store's ${l.id} is left out: another game already uses its id`] as [string, string]] : []))];
    // A seal lasts as long as the game: one removed (or never there) forgets it.
    const here = [...built, ...store];
    for (const id of sealed.keys()) if (!here.some((e) => e.info.id === id)) sealed.delete(id);
    publish([...team, ...here]);
  }

  function rescan(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await scan();
        } while (again);
      } catch (err) {
        options.log(`library: the scan failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        running = null;
        markScanned();
      }
    })();
    return running;
  }

  const entry = (id: string): LibraryEntry | null => entries.find((e) => e.info.id === id) ?? null;

  return {
    games: () => games,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rescan,
    scanned,
    entry,
    rules(id) {
      const e = entry(id);
      if (!e || e.info.kind !== "built" || !e.info.ready || !e.dir || !e.manifest) return null;
      return { rulesJs: path.join(e.dir, DIST, BUNDLE_FILES.rules), budgetMs: e.manifest.budgetMs };
    },
    seal(id, reason, lifts = false) {
      const e = entry(id);
      if (!e || e.info.kind === "team" || sealed.has(id)) return;
      sealed.set(id, reason);
      if (lifts) passing.add(id);
      publish(entries.map((x) => (x.info.id === id ? { ...x, info: { ...x.info, ready: false, sealed: x.problem ?? reason }, problem: x.problem ?? reason } : x)));
    },
  };
}
