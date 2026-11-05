// The bundle shape the rules runner relies on: rules.js alone, run as `node --permission --allow-fs-read=<rules.js>
// rules.js`, speaks the runner protocol; and the checks build_game runs on a folder.
import { spawn } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, tempDir } from "../forge/test-helpers.ts";
import { bundleGame } from "./bundle.ts";
import { BUNDLE_FILES, sdkPaths } from "./paths.ts";
import { checkRulesBundle, rulesChildArgs, stationProblems } from "./rules-check.ts";
import { typecheckGame } from "./typecheck.ts";

const sdk = sdkPaths();

function fixtureCopy(): { dir: string; out: string } {
  const base = tempDir("egb-bundle-");
  const dir = path.join(base, "tap-three");
  cpSync(path.join(FIXTURES, "tap-three"), dir, { recursive: true });
  return { dir, out: path.join(base, "out") };
}

/** Talks to a rules.js child: writes the requests, collects every stdout line until it has `count` replies. */
function play(rulesJs: string, requests: object[], count: number): Promise<{ replies: Record<string, unknown>[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, rulesChildArgs(rulesJs), { stdio: ["pipe", "pipe", "pipe"], env: {} });
    const replies: Record<string, unknown>[] = [];
    let out = "";
    let stderr = "";
    const timer = setTimeout(() => (child.kill(), reject(new Error(`timed out: ${out} ${stderr}`))), 10_000);
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const l of lines) replies.push(JSON.parse(l) as Record<string, unknown>);
      if (replies.length === 1 && replies[0]?.t === "ready") for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
      if (replies.length >= count) {
        clearTimeout(timer);
        child.stdin.end();
        child.on("exit", () => resolve({ replies, stderr }));
      }
    });
  });
}

describe("bundling a built game", () => {
  it("makes rules.js a whole program the sandboxed child runs, and screen.js an ES module", async () => {
    const g = fixtureCopy();
    const r = await bundleGame(g.dir, g.out, sdk);
    expect(r.errors).toEqual([]);
    const rulesJs = path.join(g.out, BUNDLE_FILES.rules);
    const { replies } = await play(
      rulesJs,
      [
        { t: "start", seq: 0, seed: 1, now: 1000 },
        { t: "step", seq: 1, event: { type: "tap", seat: 1, now: 1100, roll: null } },
        { t: "step", seq: 2, event: { type: "tap", seat: 1, now: 1200, roll: null } },
        { t: "step", seq: 3, event: { type: "tap", seat: 1, now: 1300, roll: null } },
      ],
      5,
    );
    expect(replies[0]).toEqual({ t: "ready" });
    expect(replies[1]).toMatchObject({ t: "state", seq: 0, state: { taps: [0, 0], winner: null }, outcome: null });
    expect(replies[4]).toMatchObject({ t: "state", seq: 3, state: { taps: [0, 3], winner: 1 }, outcome: { winner: 1 } });
    expect((replies[4]?.stations as { small: string }[]).map((s) => s.small)).toEqual(["LOSE", "WIN"]);
    expect(readFileSync(path.join(g.out, BUNDLE_FILES.screen), "utf8")).toMatch(/export\s*\{[^}]*as default/);
  });

  it("keeps stdout for the protocol: what the game prints goes to stderr", async () => {
    const g = fixtureCopy();
    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(path.join(g.dir, "rules.ts"), `console.log("loading");\nprocess.stdout.write("noise\\n");\n${rules}`);
    expect((await bundleGame(g.dir, g.out, sdk)).ok).toBe(true);
    const { replies, stderr } = await play(path.join(g.out, BUNDLE_FILES.rules), [{ t: "start", seq: 0, seed: 1, now: 0 }], 2);
    expect(replies.map((r) => r.t)).toEqual(["ready", "state"]);
    expect(stderr).toMatch(/loading/);
    expect(stderr).toMatch(/noise/);
  });

  it("the rules check plays a test match and words what's wrong", async () => {
    const g = fixtureCopy();
    await bundleGame(g.dir, g.out, sdk);
    expect(await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify")).toEqual([]);

    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(path.join(g.dir, "rules.ts"), rules.replace('return stationView(seat === 0 ? "P1" : "P2", String(state.taps[seat]), small);', 'return { tag: "P1", big: "A VERY LONG LINE", small };'));
    await bundleGame(g.dir, g.out, sdk);
    const long = await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify");
    expect(long[0]).toMatch(/after start: stations\(state\)\[0\]\.big "A VERY LONG LINE" must be at most 10/);

    writeFileSync(path.join(g.dir, "rules.ts"), rules.replace("if (state.winner !== null", 'if (event.type === "tap") throw new Error("no taps yet");\n    if (state.winner !== null'));
    await bundleGame(g.dir, g.out, sdk);
    const thrown = await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify");
    expect(thrown).toEqual(["rules.step threw on step (Player 1's tap): Error: no taps yet"]);
  });

  it("type-checks against the SDK and the two default exports", async () => {
    const g = fixtureCopy();
    expect(await typecheckGame(g.dir, sdk)).toMatchObject({ ok: true, errors: [] });
    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(path.join(g.dir, "rules.ts"), `${rules.replace("export default rules;", "export { rules };")}\nexport const n: number = "one";\n`);
    const r = await typecheckGame(g.dir, sdk);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual(expect.stringMatching(/^rules\.ts:\d+:\d+ Type 'string' is not assignable to type 'number'\. \(TS2322\)$/));
    expect(r.errors).toContainEqual(expect.stringMatching(/^the game's exports .*has no default export/));
    expect(r.errors.join("\n")).not.toContain(g.dir);
  });

  it("station views are judged against the OLED's limits", () => {
    expect(stationProblems([{ tag: "P1", big: "TAP", small: "now" }, { tag: "P2", big: "WAIT", small: "", hold: "HOLD|reading" }])).toEqual([]);
    expect(stationProblems([{ tag: "P1", big: "TAP", small: "" }])).toEqual(["stations(state) must return two views: [Player 1's, Player 2's]"]);
    expect(stationProblems([{ tag: "PLAYER", big: "é", small: 3 }, null])).toHaveLength(4);
  });
});
