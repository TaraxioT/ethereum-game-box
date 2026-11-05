// The build_game check: what the agent calls after its edits and what the Box runs before it installs. game.json and
// the folder are checked, tsc type-checks and esbuild bundles in parallel (the bundle then plays a short match in
// its own sandboxed child), and the icon is checked last. Each step is a `compile` event on the screen. The bundle
// is written to the Forge's out folder, outside the agent's reach.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TapNeed } from "@egb/sdk";
import { bundleGame } from "../bundle/bundle.ts";
import { BUNDLE_FILES, type SdkPaths } from "../bundle/paths.ts";
import { checkRulesBundle } from "../bundle/rules-check.ts";
import { typecheckGame } from "../bundle/typecheck.ts";
import type { CompileStep } from "../types.ts";
import { ICON_FILE, iconProblems } from "./icon.ts";
import { MAX_ERROR_LINES } from "./limits.ts";
import type { ForgeEventBody } from "./provider.ts";
import { readManifestFile } from "./shelf.ts";
import { manifestCheck } from "./workspace.ts";

export interface BuildCheck {
  /** game.json, the types and the bundle are all good: the game can be installed. */
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** The icon's problems. They never fail a build: the Forge asks once more, then uses a plain icon. */
  readonly iconErrors: readonly string[];
  /** Both bundles, in bytes (0 when the bundle failed). */
  readonly bytes: number;
  readonly ms: number;
}

export interface BuildOptions {
  readonly workDir: string;
  readonly outDir: string;
  readonly gameId: string;
  readonly sdk: SdkPaths;
  emit(event: ForgeEventBody): void;
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

function iconCheck(workDir: string): string[] {
  let svg: string;
  try {
    svg = readFileSync(path.join(workDir, ICON_FILE), "utf8");
  } catch {
    return ["icon.svg is missing: draw the game's icon"];
  }
  return iconProblems(svg).map((e) => `icon.svg: ${e}`);
}

/** The check for one game folder; every call rebuilds from scratch. */
export function createBuild(o: BuildOptions): () => Promise<BuildCheck> {
  const step = (s: CompileStep, errors: readonly string[], okText: string) =>
    o.emit({ type: "compile", step: s, ok: errors.length === 0, text: errors.length === 0 ? okText : (errors[0] ?? "failed") });

  return async () => {
    const t0 = performance.now();
    const manifest = manifestCheck(o.workDir, o.gameId);
    step("manifest", manifest, "game.json OK");
    const raw = readManifestFile(o.workDir) as { taps?: unknown } | null;
    const taps: TapNeed = raw?.taps === "random" ? "random" : "identify";

    const [types, bundle] = await Promise.all([
      typecheckGame(o.workDir, o.sdk).then((r) => {
        step("typecheck", r.errors, `types OK (${(r.ms / 1000).toFixed(1)} s)`);
        return r;
      }),
      bundleGame(o.workDir, o.outDir, o.sdk).then(async (r) => {
        const errors = r.ok ? await checkRulesBundle(path.join(o.outDir, BUNDLE_FILES.rules), taps) : [...r.errors];
        const bytes = r.bytes.rules + r.bytes.screen;
        step("bundle", errors, `${BUNDLE_FILES.rules} ${kb(r.bytes.rules)} · ${BUNDLE_FILES.screen} ${kb(r.bytes.screen)} · rules answered a test match`);
        return { errors, bytes: errors.length === 0 ? bytes : 0 };
      }),
    ]);
    const iconErrors = iconCheck(o.workDir);
    step("icon", iconErrors, "icon OK");
    const errors = [...manifest, ...types.errors, ...bundle.errors];
    return { ok: errors.length === 0, errors, iconErrors, bytes: bundle.bytes, ms: Math.round(performance.now() - t0) };
  };
}

/** What build_game says back to the agent. Its first line is the step's summary. */
export function formatBuild(check: BuildCheck): string {
  if (check.ok) {
    return [
      `Build OK · ${kb(check.bytes)} (${(check.ms / 1000).toFixed(1)} s)`,
      ...(check.iconErrors.length > 0
        ? ["The icon needs fixing (the game builds, but the Box will use a plain icon unless icon.svg follows the rules):", ...check.iconErrors.slice(0, 10), "Fix icon.svg, then call build_game again."]
        : ["Icon OK.", "If the game is finished, stop now and reply with a 1–2 sentence summary for the players."]),
    ].join("\n");
  }
  const lines = check.errors.flatMap((e) => e.split("\n")).filter((l) => l.trim());
  const shown = lines.slice(0, MAX_ERROR_LINES);
  const more = lines.length - shown.length;
  return [
    `Build failed · ${check.errors.length} error${check.errors.length === 1 ? "" : "s"}`,
    ...shown,
    ...(more > 0 ? [`… and ${more} more line${more === 1 ? "" : "s"}`] : []),
    "Fix these, then call build_game again.",
  ].join("\n");
}
