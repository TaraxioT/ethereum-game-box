import { defineConfig } from "vitest/config";

// The screen is one static page: its root is src/screen, and the build lands in dist/screen.
export default defineConfig({
  root: "src/screen",
  envDir: "../..",
  build: { outDir: "../../dist/screen", emptyOutDir: true, target: "es2023" },
  test: { root: ".", include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
