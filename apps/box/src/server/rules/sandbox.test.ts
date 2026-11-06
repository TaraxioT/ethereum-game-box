// Proves the rules child's refusals on the Node that runs this test (the Pi runs the same major, 26). Two layers:
//   1. Node's permission model alone: the attacks bundled without the runner or its jail, run with the child's
//      exact flags. Every refusal the plan names must hold here.
//   2. The real path: a hostile game bundled by the Forge's bundler (runner and jail included) and played by the
//      rules host. Every attack must fail, including the ones Node 26.5's permission model lets through, nothing
//      may land on disk or reach a socket, and the host must play a good game afterwards.
import { spawn } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import dgram from "node:dgram";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleGame } from "../../builder/bundle/bundle.ts";
import { BUNDLE_FILES, sdkPaths } from "../../builder/bundle/paths.ts";
import { rulesChildArgs } from "../../builder/bundle/rules-check.ts";
import { FIXTURES, tempDir } from "../../builder/forge/test-helpers.ts";
import { CHILD_FLAGS } from "./child.ts";
import { createRulesHost, type RulesHost } from "./host.ts";
import type { Targets } from "./fixtures/hostile/targets.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = tempDir("egb-sandbox-");
const secret = path.join(tmp, "secret.txt");

let connections = 0;
let datagrams = 0;
const tcp = net.createServer((socket) => {
  connections++;
  socket.destroy();
});
const udp = dgram.createSocket("udp4").on("message", () => datagrams++);

function targets(tag: string): Targets {
  return {
    secret,
    dir: tmp,
    written: path.join(tmp, `${tag}-written.txt`),
    sqlite: path.join(tmp, `${tag}-stolen.db`),
    port: (tcp.address() as net.AddressInfo).port,
    udpPort: udp.address().port,
  };
}

/** The child's environment, less what macOS adds to every process it starts. */
const own = (env: readonly string[]) => env.filter((key) => key !== "__CF_USER_TEXT_ENCODING");

/** The refusals the plan names, which the permission model itself must make. */
const PERMISSION_REFUSALS = [
  "fs read outside the bundle",
  "fs list a folder",
  "fs write",
  "fs write through createRequire",
  "child_process",
  "process.execve",
  "worker_threads",
  "process.dlopen (an addon)",
  "WASI",
  "inspector.open",
  "inspector session",
  "net.connect",
  "net.listen",
  "http.get",
  "fetch",
  "dgram",
  "dns.lookup",
  "dns.resolve",
  "process.binding('fs')",
  "process.binding('spawn_sync')",
];

/** Bundles a game folder with the Forge's bundler; returns its rules.js. */
async function bundle(dir: string): Promise<string> {
  const out = `${dir}-dist`;
  const result = await bundleGame(dir, out, sdkPaths());
  expect(result.errors).toEqual([]);
  return path.join(out, BUNDLE_FILES.rules);
}

let hostileJs = "";
let tapThreeJs = "";
let host: RulesHost;
const logs: string[] = [];

beforeAll(async () => {
  writeFileSync(secret, "the Box's secret");
  await new Promise<void>((done) => tcp.listen(0, "127.0.0.1", done));
  await new Promise<void>((done) => udp.bind(0, "127.0.0.1", done));

  const hostile = path.join(tmp, "hostile");
  cpSync(path.join(HERE, "fixtures", "hostile"), hostile, { recursive: true });
  const file = path.join(hostile, "targets.ts");
  writeFileSync(file, readFileSync(file, "utf8").replace(/export const TARGETS: Targets = .*;/, `export const TARGETS: Targets = ${JSON.stringify(targets("jailed"))};`));
  hostileJs = await bundle(hostile);

  const tapThree = path.join(tmp, "tap-three");
  cpSync(path.join(FIXTURES, "tap-three"), tapThree, { recursive: true });
  tapThreeJs = await bundle(tapThree);

  const games: Record<string, { rulesJs: string; budgetMs: number }> = {
    hostile: { rulesJs: hostileJs, budgetMs: 50 },
    // The memory test needs the time to fill the heap: a budget no manifest may ask for.
    "hostile-slow": { rulesJs: hostileJs, budgetMs: 10_000 },
    "tap-three": { rulesJs: tapThreeJs, budgetMs: 50 },
  };
  host = createRulesHost({ locate: (game) => games[game] ?? null, log: (text) => logs.push(text) });
}, 30_000);

afterAll(() => {
  host.stop();
  tcp.close();
  udp.close();
});

/** Runs a script with the rules child's flags; resolves with its stdout. */
function runWithChildFlags(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...CHILD_FLAGS, ...rulesChildArgs(script), ...args], { stdio: ["ignore", "pipe", "pipe"], env: {} });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err}`))));
  });
}

interface HostileState {
  readonly verdicts: Readonly<Record<string, string>>;
  readonly total: number;
  readonly env: readonly string[];
}

describe("the rules child's sandbox", () => {
  it(`Node ${process.version}'s permission model refuses every capability the plan names`, async () => {
    const raw = path.join(tmp, "raw.js");
    await esbuild.build({ entryPoints: [path.join(HERE, "fixtures", "raw-main.ts")], outfile: raw, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" });
    const { verdicts, env } = JSON.parse(await runWithChildFlags(raw, [JSON.stringify(targets("raw"))])) as { verdicts: Record<string, string>; env: string[] };
    for (const name of PERMISSION_REFUSALS) expect(verdicts[name], name).toMatch(/^refused (ERR_ACCESS_DENIED|ERR_DLOPEN_DISABLED)$/);
    expect(own(env)).toEqual([]);
    expect(existsSync(targets("raw").written)).toBe(false);
  });

  it("a hostile built game gets nowhere: every attack refused, nothing on disk or on a socket", async () => {
    let state = (await host.start("hostile", 1, 0)).state as HostileState;
    for (let i = 0; Object.keys(state.verdicts).length < state.total && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50));
      state = (await host.step({ type: "tick", now: i })).state as HostileState;
    }
    expect(Object.keys(state.verdicts)).toHaveLength(state.total);
    const allowed = Object.entries(state.verdicts).filter(([, verdict]) => !verdict.startsWith("refused"));
    expect(allowed).toEqual([]);
    expect(state.verdicts["node:sqlite (writes past the fs checks)"]).toBe("refused ERR_ACCESS_DENIED");
    expect(state.verdicts["process.kill the Box"]).toBe("refused ERR_ACCESS_DENIED");
    expect(own(state.env)).toEqual([]);
    const t = targets("jailed");
    expect(existsSync(t.written)).toBe(false);
    expect(existsSync(t.sqlite)).toBe(false);
    expect(readdirSync(path.dirname(hostileJs)).sort()).toEqual([BUNDLE_FILES.rules, BUNDLE_FILES.screen].sort());
    expect(connections).toBe(0);
    expect(datagrams).toBe(0);
  });

  it("a step that never ends is cut off at its budget", async () => {
    await host.start("hostile", 1, 0);
    const t0 = performance.now();
    await expect(host.step({ type: "tap", seat: 0, now: 1, roll: 7 })).rejects.toMatchObject({ code: "budget" });
    expect(performance.now() - t0).toBeLessThan(1_000);
    expect(host.running()).toBeNull();
  });

  it("a game that eats memory dies at its heap cap, and only it", async () => {
    await host.start("hostile-slow", 1, 0);
    await expect(host.step({ type: "tap", seat: 0, now: 1, roll: 9 })).rejects.toMatchObject({ code: "crash" });
  }, 20_000);

  it("the host still plays a good game afterwards", async () => {
    host.prepare("tap-three");
    let snap = await host.start("tap-three", 1, 1_000);
    for (const now of [1_100, 1_200, 1_300]) snap = await host.step({ type: "tap", seat: 0, now, roll: null });
    expect(snap.outcome).toEqual({ winner: 0 });
    expect(snap.stations.map((v) => v.small)).toEqual(["WIN", "LOSE"]);
    expect(logs.some((l) => l.includes("hostile took over its 50 ms budget"))).toBe(true);
  });
});
