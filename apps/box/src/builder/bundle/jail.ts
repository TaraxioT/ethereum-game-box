// The rules child's jail: what Node's permission model leaves open, closed before any game code runs. Bundled first
// into rules.js (runner-main.ts imports it before anything else, and ES modules evaluate in import order).
//
// The child runs as `node --permission --allow-fs-read=<rules.js> rules.js`. On Node 26.5 that refuses fs reads
// outside the bundle, every fs write, child processes, workers, addons, WASI, the inspector, sockets, DNS and
// process.binding. Measured, it still lets a module through to:
//   - node:sqlite, which opens, creates and writes database files anywhere, past both fs checks;
//   - node:v8's setHeapSnapshotNearHeapLimit, which writes a heap snapshot into the cwd when memory runs out;
//   - process.kill / process._kill, which signal any process of the same user (the Box server itself).
// A game's rules need no Node module at all, so the jail shuts the doors to every one of them: no import resolves
// (static imports were bundled away; this stops `import()` of anything), process.getBuiltinModule throws, and
// process.kill with it. The rules bundle can't import node:module itself (the bundler guard refuses Node modules),
// so the hook is installed through getBuiltinModule before that is taken away too.

/** Thrown for anything the jail refuses, with the permission model's own error code. */
function denied(what: string): never {
  throw Object.assign(new Error(`${what} isn't available to a game's rules`), { code: "ERR_ACCESS_DENIED" });
}

process.getBuiltinModule("node:module").registerHooks({
  resolve: (specifier) => denied(`import("${specifier.slice(0, 80)}")`),
});

const CLOSED = ["getBuiltinModule", "kill", "_kill", "dlopen", "binding", "_linkedBinding"] as const;

for (const name of CLOSED) {
  // Non-writable and non-configurable: game code can neither put the original back nor redefine it.
  Object.defineProperty(process, name, { value: () => denied(`process.${name}`), writable: false, configurable: false, enumerable: false });
}
