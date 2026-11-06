// The bundler guard: every import a built game's bundle resolves goes through here. Without it esbuild follows any
// import anywhere on disk, and generated code could inline `~/.claude/.credentials.json` or an env file into its
// bundle (a JSON import copies the file's contents; `with { type: "text" }` copies anything). So a game may import
// only its own files and @egb/sdk, by plain imports of code or JSON. Paths are judged by where they really land
// (symlinks resolved), after esbuild has picked them.
import { realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "esbuild";
import type { SdkPaths } from "./paths.ts";

/** What a game may import: its TypeScript, plain JavaScript and JSON data. No CSS (screen.js is one file), no assets. */
export const IMPORTABLE = [".ts", ".js", ".json"] as const;

/** The specifier the rules entry uses for the runner program (bundle.ts); nothing else may import it. */
export const RUNNER_SPECIFIER = "egb:runner";
/** The namespace of the bundler's own entry modules. */
export const ENTRY_NAMESPACE = "egb-entry";

export interface GuardOptions {
  /** The game's folder, a real path. */
  readonly gameDir: string;
  readonly sdk: SdkPaths;
  /** The runner program and the folder its own imports may come from (bundle/). */
  readonly runner: { readonly main: string; readonly dir: string };
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const within = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** `@egb/sdk` and `@egb/sdk/screen`, the two entries its package exports; anything else under it is refused. */
function sdkEntry(spec: string, sdk: SdkPaths): string | null {
  if (spec === "@egb/sdk") return sdk.index;
  if (spec === "@egb/sdk/screen") return sdk.screen;
  return null;
}

export function guardPlugin(o: GuardOptions): Plugin {
  const gameDir = real(o.gameDir);
  const sdkDir = real(o.sdk.src);
  const runnerDir = real(o.runner.dir);
  const refuse = (text: string) => ({ errors: [{ text }] });

  return {
    name: "egb-guard",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if ((args.pluginData as { guarded?: boolean } | undefined)?.guarded) return undefined;
        if (args.with && Object.keys(args.with).length > 0) {
          return refuse(`${args.path}: import attributes (with { ... }) aren't allowed`);
        }
        const fromEntry = args.namespace === ENTRY_NAMESPACE;
        const importer = args.importer && !fromEntry ? real(args.importer) : "";
        const fromRunner = !fromEntry && importer !== "" && within(runnerDir, importer);

        if (args.path === RUNNER_SPECIFIER) {
          return fromEntry ? { path: o.runner.main } : refuse(`${args.path} isn't something a game can import`);
        }
        if (args.path === "@egb/sdk" || args.path.startsWith("@egb/sdk/")) {
          const entry = sdkEntry(args.path, o.sdk);
          return entry ? { path: entry } : refuse(`${args.path} isn't exported (use @egb/sdk or @egb/sdk/screen)`);
        }
        const relative = args.path.startsWith("./") || args.path.startsWith("../");
        if (!relative && args.kind !== "entry-point") {
          return refuse(`${args.path}: a game may import only its own files (./name.ts) and @egb/sdk`);
        }

        const r = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: fromEntry ? "file" : args.namespace,
          resolveDir: args.resolveDir,
          pluginData: { guarded: true },
        });
        if (r.errors.length > 0) return { errors: r.errors };
        const target = real(r.path);
        // The game's files may import the game's files; the SDK and the runner, their own neighbours.
        const roots = fromRunner ? [runnerDir, sdkDir] : within(sdkDir, importer) ? [sdkDir] : [gameDir];
        if (!roots.some((root) => within(root, target))) {
          return refuse(`${args.path} is outside the game's folder: a game may import only its own files and @egb/sdk`);
        }
        const ext = path.extname(target).toLowerCase();
        if (!(IMPORTABLE as readonly string[]).includes(ext)) {
          return refuse(`${args.path}: ${ext || "a file without an extension"} can't be imported (only ${IMPORTABLE.join(", ")})`);
        }
        return { path: target };
      });
    },
  };
}
