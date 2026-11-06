// Where the bundler and the type checker find what a built game may use: @egb/sdk's sources and the compiler's own
// lib files. Resolved through Node's own module resolution (symlinks followed), so they are real paths wherever the
// repo sits.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** A built game's two bundles, as they are named in its `dist/`. */
export const BUNDLE_FILES = { rules: "rules.js", screen: "screen.js" } as const;

export interface SdkPaths {
  /** `@egb/sdk`: the DOM-free contract. */
  readonly index: string;
  /** `@egb/sdk/screen`: the frame's screen contract. */
  readonly screen: string;
  /** The folder both live in; SDK files may import each other inside it. */
  readonly src: string;
}

export function sdkPaths(): SdkPaths {
  const index = require.resolve("@egb/sdk");
  return { index, screen: require.resolve("@egb/sdk/screen"), src: path.dirname(index) };
}

/**
 * The folder of TypeScript's lib files (`lib.es2023.d.ts` and the rest). TypeScript 7's compiler is a native binary
 * in a package per platform, `@typescript/typescript-<platform>-<arch>`, and its lib files sit beside it.
 */
export function tsLibDir(): string {
  const fromTs = createRequire(require.resolve("typescript/package.json"));
  const native = fromTs.resolve(`@typescript/typescript-${process.platform}-${process.arch}/package.json`);
  return realpathSync(path.join(path.dirname(native), "lib"));
}
