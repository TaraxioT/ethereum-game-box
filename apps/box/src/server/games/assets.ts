// What every built game's frame loads from the Box besides the game itself, built from the screen's own sources with
// esbuild on first use and kept in memory:
//   /parts.js       the parts a built screen may use by tag, defined as it loads (screen/frame/parts.ts)
//   /parts.css      the Box's tokens and its three faces, and the frame's one element (screen/frame/parts.css)
//   /parts/<font>   the font files parts.css names
//   /frame.js       the frame's program: the runtime that loads screen.js and speaks the channel (screen/frame/frame.ts)
// Built in the server, not at release, so a dev server and the Pi serve the same thing from the same sources. esbuild
// keeps a service process (12–86 MB) after a build; it is stopped as soon as the build is done.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { mimeOf } from "../http.ts";

export interface FrameAsset {
  readonly body: Uint8Array;
  readonly type: string;
}

export interface FrameAssets {
  /** The asset at a URL path (`/parts.js`), or null. Builds them all on the first call. */
  get(urlPath: string): Promise<FrameAsset | null>;
}

const FRAME_DIR = fileURLToPath(new URL("../../screen/frame/", import.meta.url));
const OUT = "/egb-frame";

async function build(): Promise<Map<string, FrameAsset>> {
  const result = await esbuild.build({
    entryPoints: ["parts.ts", "parts.css", "frame.ts"].map((file) => path.join(FRAME_DIR, file)),
    outdir: OUT,
    entryNames: "[name]",
    assetNames: "parts/[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2023",
    minify: true,
    write: false,
    logLevel: "silent",
    loader: { ".woff2": "file", ".woff": "file" },
    // No tsconfig from disk: the screen's names Vite's client types, which esbuild has no use for.
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
  });
  const assets = new Map<string, FrameAsset>();
  for (const file of result.outputFiles) {
    const urlPath = `/${path.relative(OUT, file.path).split(path.sep).join("/")}`;
    assets.set(urlPath, { body: file.contents, type: mimeOf(file.path) });
  }
  return assets;
}

export function createFrameAssets(log: (text: string) => void): FrameAssets {
  let built: Promise<Map<string, FrameAsset>> | null = null;
  return {
    async get(urlPath) {
      built ??= build().then(
        (assets) => {
          void esbuild.stop();
          return assets;
        },
        (err: unknown) => {
          built = null;
          void esbuild.stop();
          throw err;
        },
      );
      try {
        return (await built).get(urlPath) ?? null;
      } catch (err) {
        log(`frame assets: the build failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },
  };
}
