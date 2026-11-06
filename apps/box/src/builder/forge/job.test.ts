import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sdkPaths } from "../bundle/paths.ts";
import type { ForgeEvent, ForgeProvider } from "../types.ts";
import { iconProblems } from "./icon.ts";
import { forgeDirs, installedProblems } from "./install.ts";
import { runJob, type JobSpec } from "./job.ts";
import type { AgentProvider } from "./provider.ts";
import { readShelf } from "./shelf.ts";
import { createSimProvider } from "./sim.ts";
import { brief, FIXTURES, scripted, tempDir } from "./test-helpers.ts";

const GAME = "plank-dash-k2x9";

function spec(provider: ForgeProvider, over: Partial<JobSpec> = {}): JobSpec {
  return {
    job: { id: "job-test", brief: brief(), provider, status: "queued", createdAt: 1, game: null, error: null },
    gameId: GAME,
    template: readShelf([FIXTURES])[0]!,
    dataDir: tempDir("egb-data-"),
    model: "claude-sonnet-5-5",
    maxTurns: 40,
    timeoutMs: 60_000,
    simSpeed: 0,
    ...over,
  };
}

async function run(s: JobSpec, provider: AgentProvider, cancel = new AbortController().signal) {
  const events: ForgeEvent[] = [];
  const providers = { claude: provider, sim: provider } as Record<ForgeProvider, AgentProvider>;
  await runJob(s, { providers, sdk: sdkPaths(), now: Date.now }, (e) => events.push(e), cancel);
  const statuses = events.flatMap((e) => (e.type === "status" ? [e.status] : []));
  const result = events.at(-1);
  return { events, statuses, result, installed: path.join(forgeDirs(s.dataDir).games, GAME) };
}

const breakRules = (dir: string) => writeFileSync(path.join(dir, "rules.ts"), `${readFileSync(path.join(dir, "rules.ts"), "utf8")}\nexport const broken: number = "no";\n`);
const fixRules = (dir: string) => writeFileSync(path.join(dir, "rules.ts"), readFileSync(path.join(FIXTURES, "tap-three/rules.ts"), "utf8"));

describe("one build", () => {
  it("the sim replays its recording into a real game and installs it", async () => {
    const s = spec("sim");
    const { events, statuses, result, installed } = await run(s, createSimProvider({ speed: 0 }));
    expect(result).toMatchObject({ type: "result", job: "job-test", ok: true, game: GAME, error: null });
    expect(statuses).toEqual(["preparing", "working", "compiling", "installing", "done"]);
    expect(events.find((e) => e.type === "status" && e.status === "working")).toMatchObject({ text: expect.stringMatching(/^SIMULATED/) });
    expect(events.find((e) => e.type === "status" && e.status === "done")).toMatchObject({ text: expect.stringMatching(/^Plank Dash is ready · 15 turns · SIMULATED$/) });
    // Two build_game runs: the recording's own, and the Box's final check. Each is four compile steps, all good.
    const compiles = events.filter((e) => e.type === "compile");
    expect(compiles.map((e) => e.type === "compile" && `${e.step}:${e.ok}`)).toEqual(Array(2).fill(["manifest:true", "typecheck:true", "bundle:true", "icon:true"]).flat());
    expect(readdirSync(installed).sort()).toEqual(["BLUEPRINT.md", "dist", "forge.json", "game.json", "icon.svg", "rules.ts", "screen.ts"]);
    expect(readdirSync(path.join(installed, "dist")).sort()).toEqual(["rules.js", "screen.js"]);
    expect(installedProblems(installed)).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(installed, "game.json"), "utf8"))).toMatchObject({ id: GAME, title: "Plank Dash", stakes: [2, 4], kind: "built", blurb: expect.stringMatching(/lanterns/) });
    expect(JSON.parse(readFileSync(path.join(installed, "forge.json"), "utf8"))).toMatchObject({ job: "job-test", provider: "sim", simulated: true, model: null, template: "tap-three", turns: 15 });
    // Nothing left behind: the work and out folders moved into the game.
    expect(readdirSync(forgeDirs(s.dataDir).work)).toEqual([]);
  });

  it("works through a data folder reached by a symlink", async () => {
    const real = tempDir("egb-real-");
    const link = path.join(tempDir("egb-link-"), "data");
    symlinkSync(real, link);
    const { result } = await run(spec("sim", { dataDir: link }), createSimProvider({ speed: 0 }));
    expect(result).toMatchObject({ ok: true, game: GAME });
    expect(existsSync(path.join(real, "games", GAME, "dist", "rules.js"))).toBe(true);
  });

  it("a failed check gets one resumed fix-up turn with the errors", async () => {
    const provider = scripted(async (ctx, call) => {
      if (call === 1) return void breakRules(ctx.workDir);
      expect(ctx.resume).toBe("session-1");
      expect(ctx.prompt).toMatch(/final check of the game failed[\s\S]*rules\.ts:\d+:\d+ Type 'string' is not assignable/);
      fixRules(ctx.workDir);
    });
    const { statuses, result, events } = await run(spec("claude"), provider);
    expect(result).toMatchObject({ ok: true, game: GAME });
    expect(provider.calls).toHaveLength(2);
    expect(statuses).toEqual(["preparing", "working", "compiling", "fixing", "compiling", "installing", "done"]);
    const typechecks = events.filter((e) => e.type === "compile" && e.step === "typecheck").map((e) => e.type === "compile" && e.ok);
    expect(typechecks).toEqual([false, true]);
    expect(events.find((e) => e.type === "status" && e.status === "done")).toMatchObject({ text: "Plank Dash is ready · 6 turns · $0.12" });
  });

  it("still broken after the fix-up: failed, nothing installed", async () => {
    const provider = scripted(async (ctx) => breakRules(ctx.workDir));
    const s = spec("claude");
    const { result, installed } = await run(s, provider);
    expect(result).toMatchObject({ ok: false, game: null, error: expect.stringMatching(/^The game didn't build: rules\.ts:\d+:\d+ Type 'string'/) });
    expect(provider.calls).toHaveLength(2);
    expect(existsSync(installed)).toBe(false);
  });

  it("a provider that can't resume gets no fix-up turn", async () => {
    const provider = scripted(async (ctx) => breakRules(ctx.workDir), { canResume: false });
    const { result } = await run(spec("claude"), provider);
    expect(result).toMatchObject({ ok: false });
    expect(provider.calls).toHaveLength(1);
  });

  it("a bad icon gets one more turn, then a plain icon; it never fails the game", async () => {
    const provider = scripted(async (ctx) => {
      writeFileSync(path.join(ctx.workDir, "icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><script>x()</script></svg>`);
      if (ctx.resume) expect(ctx.prompt).toMatch(/icon\.svg: no <script>[\s\S]*Fix icon\.svg only/);
    });
    const { result, events, installed } = await run(spec("claude"), provider);
    expect(result).toMatchObject({ ok: true });
    expect(provider.calls).toHaveLength(2);
    expect(events.some((e) => e.type === "status" && /^Using a plain icon \(icon\.svg: no <script>\)$/.test(e.text))).toBe(true);
    expect(iconProblems(readFileSync(path.join(installed, "icon.svg"), "utf8"))).toEqual([]);
  });

  it("an agent failure or a provider that isn't ready fails the job with its words", async () => {
    const failed = await run(spec("claude"), scripted(async () => ({ ok: false, text: "Claude is rate-limited right now; try again in a minute." })));
    expect(failed.result).toMatchObject({ ok: false, error: "Claude is rate-limited right now; try again in a minute." });
    const notReady = await run(spec("claude"), scripted(async () => {}, { ready: { ok: false, reason: "Log in first." } }));
    expect(notReady.statuses).toEqual(["preparing", "failed"]);
    expect(notReady.result).toMatchObject({ ok: false, error: "Log in first." });
  });

  it("a cancel or the time limit stops the agent", async () => {
    const waitForStop = scripted(async (ctx) => {
      await new Promise((resolve) => ctx.signal.addEventListener("abort", resolve));
      return { ok: false, text: "Stopped." };
    });
    const cancel = new AbortController();
    const cancelled = run(spec("claude"), waitForStop, cancel.signal);
    setTimeout(() => cancel.abort(), 50);
    expect((await cancelled).result).toMatchObject({ ok: false, error: "Cancelled." });
    const timedOut = await run(spec("claude", { timeoutMs: 60 }), waitForStop);
    expect(timedOut.result).toMatchObject({ ok: false, error: "The build took longer than 0 seconds." });
  });
});
