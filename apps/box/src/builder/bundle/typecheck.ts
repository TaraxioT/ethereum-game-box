// Type-checks a built game's folder with the repo's TypeScript, against the real @egb/sdk sources. The tsconfig is
// written by the Box into a temp folder, never read from the game's folder, and a contract file checks the two
// entries' default exports: rules.ts a BuiltRules, screen.ts a GameScreen. Errors come back as `file:line:col message
// (TSnnnn)`, relative to the game's folder; errors inside the SDK aren't the game's to fix and are left out.
//
// The compiler is confined to what a game may read. TypeScript 7's compiler is a native binary, so Node's permission
// model can't hold it; instead it runs behind its API with every file-system call (read, exists, list, realpath)
// answered by this module: the game's folder, the SDK's sources, TypeScript's lib files and the temp folder, by real
// path, and nothing else. Elsewhere nothing exists, so importing `/home/pi/.config/egb/env.json` (or a type query,
// or a reference directive) is "cannot find module", and no key in it ever shows in an error.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { API, DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";
import type { FileSystem } from "typescript/unstable/fs";
import { tsLibDir, type SdkPaths } from "./paths.ts";

export interface TypecheckResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly ms: number;
}

/** The contract file's name, as errors in it are shown. */
const CONTRACT = "contract.ts";
/** A slow Pi under a build still finishes a game's check in seconds; this only catches a hung compiler. */
const TSC_TIMEOUT_MS = 180_000;

function contract(gameDir: string): string {
  const at = (file: string) => JSON.stringify(path.join(gameDir, file));
  return [
    `import type { BuiltRules } from "@egb/sdk";`,
    `import type { GameScreen } from "@egb/sdk/screen";`,
    `import rules from ${at("rules.ts")};`,
    `import screen from ${at("screen.ts")};`,
    `export const rulesModule: BuiltRules<any> = rules;`,
    `export const screenModule: GameScreen = screen;`,
    "",
  ].join("\n");
}

/** Strict, browser and ES2023 libs (screen.ts draws; rules.ts must stay pure, which the rules check proves at run time). */
function gameTsconfig(gameDir: string, sdk: SdkPaths): Record<string, unknown> {
  return {
    compilerOptions: {
      target: "ES2023",
      module: "ESNext",
      moduleResolution: "Bundler",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      types: [],
      strict: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      isolatedModules: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      paths: { "@egb/sdk": [sdk.index], "@egb/sdk/screen": [sdk.screen] },
    },
    // The entries and what they import; stray files in the folder aren't bundled, so they aren't checked either.
    files: [CONTRACT, path.join(gameDir, "rules.ts"), path.join(gameDir, "screen.ts")],
  };
}

const realOrNull = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/**
 * The compiler's whole view of the disk: the files under `roots` (real paths), and the folders on the way down to
 * them. A path that leaves the roots, by its name or through a symlink, doesn't exist. No callback ever returns
 * undefined, which would let the compiler fall back to the real disk.
 */
function confinedFileSystem(roots: readonly string[], texts: Map<string, string>): FileSystem {
  const inside = (p: string): string | null => {
    const real = realOrNull(p);
    return real !== null && roots.some((root) => real === root || real.startsWith(root + path.sep)) ? real : null;
  };
  const onTheWay = (dir: string) => roots.some((root) => root.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep));
  const kind = (p: string) => {
    const real = inside(p);
    if (!real) return null;
    const info = statSync(real, { throwIfNoEntry: false });
    return info?.isFile() ? "file" : info?.isDirectory() ? "dir" : null;
  };
  return {
    readFile(file) {
      const real = kind(file) === "file" ? inside(file) : null;
      if (!real) return null;
      const text = readFileSync(real, "utf8");
      texts.set(path.resolve(file), text);
      texts.set(real, text);
      return text;
    },
    fileExists: (file) => kind(file) === "file",
    directoryExists: (dir) => kind(dir) === "dir" || onTheWay(path.resolve(dir)),
    getAccessibleEntries(dir) {
      if (kind(dir) !== "dir") return { files: [], directories: [] };
      const entries = readdirSync(dir, { withFileTypes: true });
      return { files: entries.filter((e) => e.isFile()).map((e) => e.name), directories: entries.filter((e) => e.isDirectory()).map((e) => e.name) };
    },
    realpath: (p) => inside(p) ?? p,
  };
}

/** 1-based line and column of offset `pos` in `text`. */
function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return { line, col: pos - before.lastIndexOf("\n") };
}

/** A diagnostic's message with its chain, in one line. */
const message = (d: Diagnostic): string => [d.text, ...(d.messageChain ?? []).map(message)].join(" ");

/** The game's own errors, as the agent reads them. */
function describeDiagnostics(diagnostics: readonly Diagnostic[], o: { gameDirs: readonly string[]; contract: string; sdkSrc: string; texts: ReadonlyMap<string, string> }): string[] {
  const clean = (text: string) => o.gameDirs.reduce((t, dir) => t.split(`${dir}${path.sep}`).join(""), text);
  const errors: string[] = [];
  for (const d of diagnostics) {
    if (d.category !== DiagnosticCategory.Error) continue;
    const text = `${clean(message(d))} (TS${d.code})`;
    if (!d.fileName) {
      errors.push(text);
      continue;
    }
    const file = path.resolve(d.fileName);
    if (file.startsWith(o.sdkSrc + path.sep)) continue;
    if (file === o.contract) {
      errors.push(`the game's exports ${text}`);
      continue;
    }
    const { line, col } = lineCol(o.texts.get(file) ?? "", d.pos);
    errors.push(`${clean(file).split(path.sep).join("/")}:${line}:${col} ${text}`);
  }
  return [...new Set(errors)];
}

async function check(dir: string, gameDir: string, sdk: SdkPaths): Promise<string[]> {
  const realGame = realpathSync(gameDir);
  const texts = new Map<string, string>();
  const fs = confinedFileSystem([realGame, realpathSync(sdk.src), tsLibDir(), dir], texts);
  const api = new API({ cwd: dir, fs });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the type checker didn't finish within ${TSC_TIMEOUT_MS / 1000} s`)), TSC_TIMEOUT_MS);
  });
  try {
    const run = (async () => {
      const snapshot = await api.updateSnapshot({ openProjects: [path.join(dir, "tsconfig.json")] });
      const project = snapshot.getProjects()[0];
      if (!project) throw new Error("the type checker couldn't open the game's project");
      const p = project.program;
      const lists = await Promise.all([p.getConfigFileParsingDiagnostics(), p.getProgramDiagnostics(), p.getGlobalDiagnostics(), p.getSyntacticDiagnostics(), p.getSemanticDiagnostics()]);
      return lists.flat();
    })();
    const diagnostics = await Promise.race([run, timeout]);
    return describeDiagnostics(diagnostics, { gameDirs: [gameDir, realGame], contract: path.join(dir, CONTRACT), sdkSrc: realpathSync(sdk.src), texts });
  } finally {
    clearTimeout(timer);
    await api.close();
  }
}

export async function typecheckGame(gameDir: string, sdk: SdkPaths): Promise<TypecheckResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  // Real path: the confined file system answers by real paths, and the errors name files by them.
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "egb-tsc-")));
  try {
    await writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(gameTsconfig(gameDir, sdk), null, 2));
    await writeFile(path.join(dir, CONTRACT), contract(gameDir));
    const errors = await check(dir, gameDir, sdk).catch((error: unknown) => [error instanceof Error ? error.message : String(error)]);
    return { ok: errors.length === 0, errors, ms: ms() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
