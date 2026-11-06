import { defineConfig } from 'vitest/config';

// `build` bundles the package as a library into dist/ (never published): it proves the stylesheet's imports (the
// Grid's tokens and fonts from @egb/box) and the modules resolve, as a site's build will.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2023',
    cssCodeSplit: true,
    lib: { entry: { dom: 'src/dom.ts', chrome: 'src/chrome.ts', schematic: 'src/schematic.css' }, formats: ['es'] },
    rollupOptions: { external: [/^@egb\/shared/, /^viem/] },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'happy-dom' },
});
