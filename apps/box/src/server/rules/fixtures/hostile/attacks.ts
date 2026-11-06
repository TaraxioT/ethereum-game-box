// Every way out of the rules child a hostile game might try, for the sandbox tests. Each attack resolves when it got
// through and rejects when it was refused; `runAttacks` records which, with the refusal's code. The modules come from
// process.getBuiltinModule or import(), the two doors a bundled game has (the bundler refuses static Node imports).
import type { Targets } from "./targets.ts";

export type Verdict = `ALLOWED ${string}` | `refused ${string}`;

type Attack = (t: Targets) => unknown;

const load = <T>(name: string): T => process.getBuiltinModule(name) as T;
type Fs = typeof import("node:fs");
/** process.binding is deprecated and gone from Node's types, but still there to try. */
const binding = (name: string): unknown => (process as unknown as { binding(name: string): unknown }).binding(name);

/** A socket attempt that settles on its first connect or error. */
function settle(start: (ok: (v: unknown) => void, fail: (e: unknown) => void) => void): Promise<unknown> {
  return new Promise((ok, fail) => {
    start(ok, fail);
    setTimeout(() => fail(Object.assign(new Error("no answer"), { code: "TIMEOUT" })), 2_000);
  });
}

export const ATTACKS: Readonly<Record<string, Attack>> = {
  "fs read outside the bundle": (t) => load<Fs>("node:fs").readFileSync(t.secret, "utf8"),
  "fs list a folder": (t) => load<Fs>("node:fs").readdirSync(t.dir),
  "fs write": (t) => load<Fs>("node:fs").writeFileSync(t.written, "pwned"),
  "fs write through createRequire": (t) => load<typeof import("node:module")>("node:module").createRequire(t.secret)("node:fs").writeFileSync(t.written, "pwned"),
  "child_process": () => load<typeof import("node:child_process")>("node:child_process").execFileSync("/bin/echo", ["pwned"]),
  "process.execve": () => process.execve!("/bin/echo", ["echo", "pwned"]),
  "worker_threads": () => new (load<typeof import("node:worker_threads")>("node:worker_threads").Worker)("1", { eval: true }),
  "process.dlopen (an addon)": (t) => process.dlopen({ exports: {} }, t.secret),
  "WASI": () => new (load<typeof import("node:wasi")>("node:wasi").WASI)({ version: "preview1" }),
  "inspector.open": () => load<typeof import("node:inspector")>("node:inspector").open(0),
  "inspector session": () => new (load<typeof import("node:inspector")>("node:inspector").Session)().connect(),
  "net.connect": (t) =>
    settle((ok, fail) => {
      const socket = load<typeof import("node:net")>("node:net").connect(t.port, "127.0.0.1");
      socket.on("connect", () => ok(socket.destroy())).on("error", fail);
    }),
  "net.listen": () =>
    settle((ok, fail) => {
      const server = load<typeof import("node:net")>("node:net").createServer();
      server.on("error", fail).listen(0, () => ok(server.close()));
    }),
  "http.get": (t) =>
    settle((ok, fail) => {
      load<typeof import("node:http")>("node:http").get(`http://127.0.0.1:${t.port}/`, ok).on("error", fail);
    }),
  "fetch": (t) => fetch(`http://127.0.0.1:${t.port}/`),
  "dgram": (t) =>
    settle((ok, fail) => {
      const socket = load<typeof import("node:dgram")>("node:dgram").createSocket("udp4");
      socket.on("error", fail);
      socket.send("pwned", t.udpPort, "127.0.0.1", (err) => (err ? fail(err) : ok(socket.close())));
    }),
  "dns.lookup": () => load<typeof import("node:dns")>("node:dns").promises.lookup("localhost"),
  "dns.resolve": () => load<typeof import("node:dns")>("node:dns").promises.resolve4("example.com"),
  "process.binding('fs')": () => binding("fs"),
  "process.binding('spawn_sync')": () => binding("spawn_sync"),
  "node:sqlite (writes past the fs checks)": (t) => new (load<typeof import("node:sqlite")>("node:sqlite").DatabaseSync)(t.sqlite).exec("create table pwned (x)"),
  "v8 heap snapshot (writes past the fs checks)": () => load<typeof import("node:v8")>("node:v8").setHeapSnapshotNearHeapLimit(1),
  "process.kill the Box": () => process.kill(process.ppid, 0),
  "process._kill the Box": () => (process as unknown as { _kill(pid: number, signal: number): number })._kill(process.ppid, 0),
  "import('node:fs')": async (t) => ((await import(["node", "fs"].join(":"))) as Fs).readFileSync(t.secret, "utf8"),
  "import('node:sqlite')": async (t) => new ((await import(["node", "sqlite"].join(":"))) as typeof import("node:sqlite")).DatabaseSync(t.sqlite),
  "import(data: URL)": () => import(["data:text/javascript", "export default 1"].join(",")),
};

function codeOf(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown }; name?: unknown };
  return String(e?.code ?? e?.cause?.code ?? e?.name ?? "error");
}

/** Runs every attack; `onVerdict` hears each as it settles (sync ones at once, sockets and DNS later). */
export function runAttacks(targets: Targets, onVerdict: (name: string, verdict: Verdict) => void): Promise<void> {
  return Promise.all(
    Object.entries(ATTACKS).map(async ([name, attack]) => {
      try {
        const got = await attack(targets);
        onVerdict(name, `ALLOWED ${String(got).slice(0, 40)}`);
      } catch (err) {
        onVerdict(name, `refused ${codeOf(err)}`);
      }
    }),
  ).then(() => undefined);
}
