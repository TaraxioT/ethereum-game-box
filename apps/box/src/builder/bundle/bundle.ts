// Turns a built game's folder into its two bundles: `rules.js` for the rules child (Node, ES module, the runner
// program and the rules in one file) and `screen.js` for the kiosk's sandboxed frame (browser, ES module whose default
// export is the GameScreen). Both are single files with no imports left, so neither needs anything else to load.
//
// It builds into a fresh folder next to `outDir` and swaps it in only when both bundles built, so a failed rebuild
// never leaves half a bundle behind.
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { ENTRY_NAMESPACE, guardPlugin, RUNNER_SPECIFIER } from "./guard.ts";
import { BUNDLE_FILES, type SdkPaths } from "./paths.ts";

/** The largest each bundle may be. A Pi loads both on every match; a game that needs more is doing too much. */
export const BUNDLE_LIMITS = { rules: 256 * 1024, screen: 768 * 1024 } as const;

const RUNNER_MAIN = fileURLToPath(new URL("./runner-main.ts", import.meta.url));

/** The rules entry: the runner first (it takes stdout before any game code runs), then the game's rules. */
const RULES_ENTRY = `import { serve } from "${RUNNER_SPECIFIER}";\nimport rules from "./rules.ts";\nserve(rules);\n`;

export interface BundleResult {
  readonly ok: boolean;
  /** `file:line:col message`, relative to the game's folder. */
  readonly errors: readonly string[];
  readonly bytes: { readonly rules: number; readonly screen: number };
  readonly ms: number;
}

/**
 * Settings that never come from disk: with `tsconfigRaw` set, esbuild reads no tsconfig.json, so a game can't steer
 * its own build. verbatimModuleSyntax off: a type imported without `import type` is dropped, not kept as an import.
 */
const TSCONFIG_RAW = { compilerOptions: { verbatimModuleSyntax: false, useDefineForClassFields: true } };

function entryPlugin(gameDir: string): esbuild.Plugin {
  return {
    name: "egb-entry",
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${ENTRY_NAMESPACE}:`) }, (args) => ({ path: args.path.slice(ENTRY_NAMESPACE.length + 1), namespace: ENTRY_NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: ENTRY_NAMESPACE }, () => ({ contents: RULES_ENTRY, loader: "ts", resolveDir: gameDir }));
    },
  };
}

function formatMessage(m: esbuild.Message, gameDir: string): string {
  const loc = m.location;
  if (!loc) return m.text;
  const file = path.isAbsolute(loc.file) ? path.relative(gameDir, loc.file) : loc.file;
  return `${file.split(path.sep).join("/")}:${loc.line}:${loc.column + 1} ${m.text}`;
}

const isBuildFailure = (e: unknown): e is esbuild.BuildFailure => !!e && typeof e === "object" && Array.isArray((e as esbuild.BuildFailure).errors);

export async function bundleGame(gameDir: string, outDir: string, sdk: SdkPaths): Promise<BundleResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const staging = `${outDir}.building-${process.pid}-${Date.now().toString(36)}`;
  const shared: esbuild.BuildOptions = {
    bundle: true,
    format: "esm",
    write: true,
    logLevel: "silent",
    sourcemap: false,
    legalComments: "none",
    absWorkingDir: gameDir,
    tsconfigRaw: TSCONFIG_RAW,
    // esbuild's own resolver must not wander: no NODE_PATH, no package.json "browser" maps, no symlinked packages.
    nodePaths: [],
    plugins: [entryPlugin(gameDir), guardPlugin({ gameDir, sdk, runner: { main: RUNNER_MAIN, dir: path.dirname(RUNNER_MAIN) } })],
  };
  const builds = [
    esbuild.build({ ...shared, entryPoints: [`${ENTRY_NAMESPACE}:rules`], outfile: path.join(staging, BUNDLE_FILES.rules), platform: "node", target: "node22" }),
    esbuild.build({ ...shared, entryPoints: [path.join(gameDir, "screen.ts")], outfile: path.join(staging, BUNDLE_FILES.screen), platform: "browser", target: "es2022", minify: true }),
  ];
  const settled = await Promise.allSettled(builds);
  const errors = settled.flatMap((s) =>
    s.status === "fulfilled" ? [] : isBuildFailure(s.reason) ? s.reason.errors.map((m) => formatMessage(m, gameDir)) : [String((s.reason as Error)?.message ?? s.reason)],
  );
  if (errors.length > 0) {
    await rm(staging, { recursive: true, force: true });
    return { ok: false, errors: [...new Set(errors)], bytes: { rules: 0, screen: 0 }, ms: ms() };
  }
  const bytes = {
    rules: (await stat(path.join(staging, BUNDLE_FILES.rules))).size,
    screen: (await stat(path.join(staging, BUNDLE_FILES.screen))).size,
  };
  const tooBig = (["rules", "screen"] as const)
    .filter((k) => bytes[k] > BUNDLE_LIMITS[k])
    .map((k) => `${BUNDLE_FILES[k]} is ${Math.ceil(bytes[k] / 1024)} KB: the limit is ${BUNDLE_LIMITS[k] / 1024} KB`);
  if (tooBig.length > 0) {
    await rm(staging, { recursive: true, force: true });
    return { ok: false, errors: tooBig, bytes, ms: ms() };
  }
  await rm(outDir, { recursive: true, force: true });
  await rename(staging, outDir);
  return { ok: true, errors: [], bytes, ms: ms() };
}
