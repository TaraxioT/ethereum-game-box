// Where the bundler and the type checker find what a built game may use: @egb/sdk's sources and the repo's tsc.
// Resolved through Node's own module resolution (symlinks followed), so they are real paths wherever the repo sits.
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

/** The repo's TypeScript compiler (its `bin/tsc`, run with this Node). */
export function tscPath(): string {
  return path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
}
