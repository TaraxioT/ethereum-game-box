// Type-checks a built game's folder with the repo's tsc, against the real @egb/sdk sources. The tsconfig is written
// by the Box into a temp folder, never read from the game's folder, and a contract file checks the two entries'
// default exports: rules.ts a BuiltRules, screen.ts a GameScreen. Errors come back as `file:line:col message
// (TSnnnn)`, relative to the game's folder; errors inside the SDK aren't the game's to fix and are left out.
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tscPath, type SdkPaths } from "./paths.ts";

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
export function gameTsconfig(gameDir: string, sdk: SdkPaths): Record<string, unknown> {
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

/** tsc's `file(line,col): error TSnnnn: message` lines (with indented continuations) for the game's own files. */
export function parseTscOutput(output: string, gameDir: string, cwd: string, sdkSrc: string): string[] {
  const errors: string[] = [];
  let keep = false;
  const clean = (text: string) => text.split(`${gameDir}${path.sep}`).join("");
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (m) {
      const [, fileText = "", row, col, code, text = ""] = m;
      const file = path.resolve(cwd, fileText);
      keep = !file.startsWith(sdkSrc + path.sep);
      if (!keep) continue;
      const where = file === path.join(cwd, CONTRACT) ? "the game's exports" : `${path.relative(gameDir, file).split(path.sep).join("/")}:${row}:${col}`;
      errors.push(`${where} ${clean(text)} (${code})`);
      continue;
    }
    const general = /^error (TS\d+): (.*)$/.exec(line);
    if (general) {
      keep = true;
      errors.push(`${clean(general[2] ?? "")} (${general[1]})`);
    } else if (keep && /^\s+\S/.test(line) && errors.length > 0) {
      errors[errors.length - 1] = `${errors[errors.length - 1]} ${clean(line.trim())}`;
    }
  }
  return errors;
}

function run(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    execFile(process.execPath, args, { cwd, timeout: TSC_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      done({ code, output: `${stdout}${stderr}` });
    });
  });
}

export async function typecheckGame(gameDir: string, sdk: SdkPaths): Promise<TypecheckResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  // Real path: tsc prints paths relative to its (resolved) working folder, and the parser resolves them back.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "egb-tsc-")));
  try {
    await writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(gameTsconfig(gameDir, sdk), null, 2));
    await writeFile(path.join(dir, CONTRACT), contract(gameDir));
    const { code, output } = await run([tscPath(), "-p", path.join(dir, "tsconfig.json"), "--pretty", "false"], dir);
    const errors = parseTscOutput(output, gameDir, dir, sdk.src);
    // A compiler that failed without one error line (a crash, a timeout) still fails the check.
    if (code !== 0 && errors.length === 0 && !/error TS\d+/.test(output)) {
      errors.push(output.trim().split("\n").slice(0, 3).join(" ") || `tsc exited with ${code}`);
    }
    return { ok: errors.length === 0, errors, ms: ms() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
