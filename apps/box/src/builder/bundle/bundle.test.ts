// The bundle shape the rules runner relies on: rules.js alone, run as `node --permission --allow-fs-read=<rules.js>
// rules.js`, speaks the runner protocol; and the checks build_game runs on a folder.
import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIXTURES, playRules as play, tempDir } from "../forge/test-helpers.ts";
import { bundleGame } from "./bundle.ts";
import { BUNDLE_FILES, sdkPaths } from "./paths.ts";
import { checkRulesBundle, stationProblems } from "./rules-check.ts";
import { typecheckGame } from "./typecheck.ts";

const sdk = sdkPaths();

function fixtureCopy(): { dir: string; out: string } {
  const base = tempDir("egb-bundle-");
  const dir = path.join(base, "tap-three");
  cpSync(path.join(FIXTURES, "tap-three"), dir, { recursive: true });
  return { dir, out: path.join(base, "out") };
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
    expect(replies[4]).toMatchObject({ stations: [{ small: "LOSE" }, { small: "WIN" }] });
    expect(readFileSync(path.join(g.out, BUNDLE_FILES.screen), "utf8")).toMatch(/export\s*\{[^}]*as default/);
  });

  it("keeps stdout for the protocol: what the game prints goes to stderr", async () => {
    const g = fixtureCopy();
    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(path.join(g.dir, "rules.ts"), `console.log("loading");\nprocess.stdout.write("noise\\n");\n${rules}`);
    expect((await bundleGame(g.dir, g.out, sdk)).ok).toBe(true);
    const { replies, stderr } = await play(path.join(g.out, BUNDLE_FILES.rules), [{ t: "start", seq: 0, seed: 1, now: 0 }], 2);
    expect(replies.map((r) => r.t)).toEqual(["ready", "state"]);
    await vi.waitFor(() => expect(stderr()).toMatch(/loading\nnoise/));
  });

  it("the rules check plays a test match and words what's wrong", async () => {
    const g = fixtureCopy();
    await bundleGame(g.dir, g.out, sdk);
    expect(await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify")).toEqual([]);

    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(path.join(g.dir, "rules.ts"), rules.replace('return stationView(seat === 0 ? "P1" : "P2", String(state.taps[seat]), small);', 'return { tag: "P1", big: "A VERY VERY LONG LINE INDEED", small };'));
    await bundleGame(g.dir, g.out, sdk);
    const long = await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify");
    expect(long[0]).toMatch(/after start: stations\(state\)\[0\]\.big "A VERY VERY LONG LINE IN" must be at most 24/);

    writeFileSync(path.join(g.dir, "rules.ts"), rules.replace("if (state.winner !== null", 'if (event.type === "tap") throw new Error("no taps yet");\n    if (state.winner !== null'));
    await bundleGame(g.dir, g.out, sdk);
    const thrown = await checkRulesBundle(path.join(g.out, BUNDLE_FILES.rules), "identify");
    expect(thrown).toEqual(["rules.step threw on step (Player 1's tap): Error: no taps yet"]);
  });

  it("runs rules.js as the rules host does: its heap cap, its line cap, its reply check, error messages cut short", async () => {
    const dir = tempDir("egb-check-");
    /** A rules.js by hand: says ready, then runs `onRequest(req)` for each request line. */
    const rulesJs = (name: string, onRequest: string) => {
      const file = path.join(dir, `${name}.js`);
      writeFileSync(file, `const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
send({ t: "ready" });
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { buf += c; for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) { const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); ${onRequest} } });
`);
      return file;
    };
    const long = await checkRulesBundle(rulesJs("long", 'send({ t: "error", seq: req.seq, message: "E".repeat(10_000) });'), "identify");
    expect(long).toEqual([`rules.start threw on start: ${"E".repeat(300)}`]);
    expect(await checkRulesBundle(rulesJs("flood", 'process.stdout.write("x".repeat(300 * 1024));'), "identify")).toEqual(["rules.js wrote a line over 256 KB"]);
    const shapeless = await checkRulesBundle(rulesJs("shapeless", 'send({ t: "state", seq: req.seq, state: 1, outcome: null, stations: [] });'), "identify");
    expect(shapeless).toEqual(["rules.js broke the protocol: stations(state) must return two views: [Player 1's, Player 2's]"]);
    const t0 = performance.now();
    const hoarder = await checkRulesBundle(rulesJs("hoarder", "const hoard = []; for (;;) hoard.push(new Array(1 << 16).fill(1));"), "identify");
    expect(hoarder).toEqual([expect.stringMatching(/^rules\.js (was killed \(SIGABRT\)|exited \(\d+\)) before answering every request/)]);
    expect(performance.now() - t0).toBeLessThan(8_000);
  }, 20_000);

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

  it("confines the type checker to the game, the SDK and TypeScript's libs: nothing outside exists, so no key leaks", async () => {
    const g = fixtureCopy();
    const outside = tempDir("egb-outside-");
    const secrets = path.join(outside, "env.json");
    writeFileSync(secrets, JSON.stringify({ ANTHROPIC_API_KEY_ZQX: "sk-secret", RPC_URL_ZQX: "https://rpc.example/key" }));
    symlinkSync(secrets, path.join(g.dir, "linked.json"));
    const rules = readFileSync(path.join(g.dir, "rules.ts"), "utf8");
    writeFileSync(
      path.join(g.dir, "rules.ts"),
      [
        `import env from ${JSON.stringify(secrets)};`,
        `import linked from "./linked.json";`,
        `type Env = typeof import(${JSON.stringify(secrets)});`,
        `export const a: number = env;`,
        `export const b: number = linked;`,
        `export const c: Env = 1;`,
        `/* é */ export const d: number = "x";`,
        rules,
      ].join("\n"),
    );
    const r = await typecheckGame(g.dir, sdk);
    expect(r.ok).toBe(false);
    const text = r.errors.join("\n");
    expect(text).not.toMatch(/ZQX|sk-secret|rpc\.example/);
    expect(r.errors.filter((e) => /Cannot find module/.test(e))).toHaveLength(3);
    // Columns count characters, as an editor does, not the bytes of an "é" before them.
    expect(r.errors).toContainEqual("rules.ts:7:22 Type 'string' is not assignable to type 'number'. (TS2322)");
  });

  it("station views are judged against the OLED's limits", () => {
    expect(stationProblems([{ tag: "P1", big: "TAP", small: "now" }, { tag: "P2", big: "WAIT", small: "", hold: "HOLD|reading" }])).toEqual([]);
    expect(stationProblems([{ tag: "P1", big: "TAP", small: "" }])).toEqual(["stations(state) must return two views: [Player 1's, Player 2's]"]);
    expect(stationProblems([{ tag: "PLAYER", big: "é", small: 3 }, null])).toHaveLength(4);
  });
});
