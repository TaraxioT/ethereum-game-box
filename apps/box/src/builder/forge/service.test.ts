import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLE_FILES } from "../bundle/paths.ts";
import { rulesChildArgs } from "../bundle/rules-check.ts";
import { createEditLock } from "../designer/lock.ts";
import type { ForgeEvent } from "../types.ts";
import { forgeDirs } from "./install.ts";
import { createForge, ForgeRequestError, type ForgeConfig, type Launcher } from "./service.ts";
import { brief, FIXTURES, inProcess, scripted, tempDir, until } from "./test-helpers.ts";

const finished = (s: string | undefined) => s === "done" || s === "failed";

function config(over: Partial<ForgeConfig> = {}): ForgeConfig {
  return { dataDir: tempDir("egb-data-"), gameRoots: [FIXTURES], env: { PATH: process.env.PATH, HOME: process.env.HOME }, simSpeed: 0, log: () => {}, ...over };
}

/** A provider held open until the test lets it go. */
function gated() {
  const gates: (() => void)[] = [];
  const provider = scripted((ctx) => new Promise((resolve) => {
    gates.push(() => resolve());
    ctx.signal.addEventListener("abort", () => resolve({ ok: false, text: "Stopped." }));
  }));
  return { provider, open: (i: number) => gates[i]?.() };
}

/** Asks a rules.js child, sandboxed as the rules runner will run it, for a start and two taps. */
function playRules(rulesJs: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, rulesChildArgs(rulesJs), { stdio: ["pipe", "pipe", "inherit"], env: {} });
    const replies: Record<string, unknown>[] = [];
    let buffer = "";
    const timer = setTimeout(() => (child.kill(), reject(new Error("rules.js didn't answer"))), 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) replies.push(JSON.parse(line) as Record<string, unknown>);
      if (replies[0]?.t === "ready" && replies.length === 1) {
        child.stdin.write(`${JSON.stringify({ t: "start", seq: 0, seed: 42, now: 1_000 })}\n`);
        child.stdin.write(`${JSON.stringify({ t: "step", seq: 1, event: { type: "tap", seat: 0, now: 1_400, roll: null } })}\n`);
        child.stdin.write(`${JSON.stringify({ t: "step", seq: 2, event: { type: "tap", seat: 1, now: 1_500, roll: null } })}\n`);
      }
      if (replies.length === 4) {
        clearTimeout(timer);
        child.kill();
        resolve(replies);
      }
    });
  });
}

describe("the Forge service", () => {
  it("end to end: a sim build in its own child process, events with a replay, an installed game whose rules.js runs sandboxed", async () => {
    let libraryChanges = 0;
    const c = config({ onLibraryChange: () => libraryChanges++ });
    const forge = createForge(c);
    expect(forge.shelf().map((t) => t.id)).toEqual(["tap-three"]);
    expect(forge.ready("sim")).toEqual({ ok: true, reason: null });
    const live: ForgeEvent[] = [];
    forge.subscribe((e) => live.push(e));

    const job = forge.submit(brief(), "sim");
    expect(job).toMatchObject({ provider: "sim", status: "queued", game: null, error: null, brief: brief() });
    await until(() => finished(forge.get(job.id)?.status), 60_000);
    const done = forge.get(job.id)!;
    expect(done).toMatchObject({ status: "done", error: null, game: expect.stringMatching(/^plank-dash-[a-z2-9]{4}$/) });
    expect(libraryChanges).toBe(1);

    // A screen that subscribes late gets the whole build first.
    const replayed: ForgeEvent[] = [];
    forge.subscribe((e) => replayed.push(e), { replay: job.id });
    expect(replayed).toEqual(forge.events(job.id));
    expect(replayed).toEqual(live);
    expect(replayed.map((e) => e.type)).toEqual(expect.arrayContaining(["status", "say", "tool", "tool_done", "compile", "result"]));
    expect(replayed.every((e) => e.job === job.id && typeof e.at === "number")).toBe(true);
    expect(replayed.at(-1)).toEqual({ type: "result", job: job.id, at: expect.any(Number), ok: true, game: done.game, error: null });

    // The installed game's rules, run exactly as the rules runner will: node --permission, reading only rules.js.
    const installed = path.join(forgeDirs(c.dataDir).games, done.game!);
    const replies = await playRules(path.join(installed, "dist", BUNDLE_FILES.rules));
    expect(replies[0]).toEqual({ t: "ready" });
    expect(replies[1]).toMatchObject({ t: "state", seq: 0, state: { startedAt: 1_000, lit: [0, 0], over: false }, outcome: null });
    expect(replies[3]).toMatchObject({ t: "state", seq: 2, state: { lit: [1, 1] }, outcome: null, stations: [{ tag: "P1", big: "1/7" }, { tag: "P2", big: "1/7" }] });
    expect(typeof replies[3]?.ms).toBe("number");
    await forge.stop();
  }, 90_000);

  it("runs one build at a time, holds the Designer's lock until the last ends, and lists the newest first", async () => {
    const { provider, open } = gated();
    const lock = createEditLock();
    const forge = createForge(config({ launch: inProcess({ claude: provider }), lock }));
    const a = forge.submit(brief({ title: "First" }), "claude");
    const b = forge.submit(brief({ title: "Second" }), "claude");
    await until(() => provider.calls.length === 1);
    expect(forge.get(a.id)?.status).toBe("working");
    expect(forge.get(b.id)?.status).toBe("queued");
    expect(forge.events(b.id)).toMatchObject([{ type: "status", status: "queued", text: "Waiting for the build before it" }]);
    open(0);
    await until(() => provider.calls.length === 2);
    expect(forge.get(a.id)?.status).toBe("done");
    expect(lock.held()).toBe(true);
    open(1);
    await until(() => finished(forge.get(b.id)?.status));
    expect(lock.held()).toBe(false);
    expect(forge.list().map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it("cancels a queued build before it runs and a running one mid-agent; not one that is over", async () => {
    const { provider } = gated();
    const forge = createForge(config({ launch: inProcess({ claude: provider }) }));
    const a = forge.submit(brief(), "claude");
    const b = forge.submit(brief(), "claude");
    await until(() => provider.calls.length === 1);
    expect(forge.cancel(b.id)).toBe(true);
    expect(forge.get(b.id)).toMatchObject({ status: "failed", error: "Cancelled." });
    expect(forge.cancel(a.id)).toBe(true);
    await until(() => finished(forge.get(a.id)?.status));
    expect(forge.get(a.id)).toMatchObject({ status: "failed", error: "Cancelled." });
    expect(provider.calls).toHaveLength(1);
    expect(forge.cancel(a.id)).toBe(false);
    expect(forge.cancel("job-nope")).toBe(false);
  });

  it("fails a build whose process vanished without a result", async () => {
    const lost: Launcher = (_spec, onEvent) => {
      onEvent({ type: "status", job: _spec.job.id, at: 1, status: "preparing", text: "Setting up the game folder" });
      return { cancel: () => {}, done: Promise.resolve() };
    };
    const forge = createForge(config({ launch: lost }));
    const job = forge.submit(brief(), "claude");
    await until(() => finished(forge.get(job.id)?.status));
    expect(forge.get(job.id)).toMatchObject({ status: "failed", error: "The build stopped unexpectedly." });
  });

  it("refuses briefs and providers it can't take", () => {
    const forge = createForge(config({ launch: inProcess({}) }));
    expect(() => forge.submit(brief({ template: "nope" }), "claude")).toThrow(ForgeRequestError);
    expect(() => forge.submit(brief({ stakes: [3, 1] }), "claude")).toThrow(/ascending/);
    expect(() => forge.submit(brief(), "gpt" as never)).toThrow(/Unknown Forge provider/);
    expect(forge.list()).toEqual([]);
  });

  it("keeps its records across a restart: a cut-off build fails, a queued one runs", async () => {
    const c = config({ launch: inProcess({}) });
    const first = createForge(c);
    const done = first.submit(brief(), "sim");
    await until(() => finished(first.get(done.id)?.status));
    await first.stop();
    const jobs = forgeDirs(c.dataDir).jobs;
    const write = (id: string, status: string, createdAt: number) =>
      writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify({ v: 1, job: { id, brief: brief(), provider: "sim", status, createdAt, game: null, error: null }, gameId: `${id}-game`, events: [] }));
    write("job-cut", "working", 2);
    write("job-waiting", "queued", 3);
    writeFileSync(path.join(jobs, "job-torn.json"), "{ not json");

    const second = createForge(c);
    expect(second.get("job-cut")).toMatchObject({ status: "failed", error: "The Box restarted during this build." });
    expect(second.get(done.id)).toMatchObject({ status: "done", game: first.get(done.id)?.game });
    await until(() => finished(second.get("job-waiting")?.status));
    expect(second.get("job-waiting")).toMatchObject({ status: "done", game: "job-waiting-game" });
    expect(second.list()).toHaveLength(3);
    await second.stop();
    expect(JSON.parse(readFileSync(path.join(jobs, "job-cut.json"), "utf8")).job.status).toBe("failed");
  }, 30_000);

  it("removes an installed built game, and nothing else", async () => {
    let changes = 0;
    const c = config({ launch: inProcess({}), onLibraryChange: () => changes++ });
    const forge = createForge(c);
    const job = forge.submit(brief(), "sim");
    await until(() => finished(forge.get(job.id)?.status));
    const game = forge.get(job.id)!.game!;
    const games = forgeDirs(c.dataDir).games;
    mkdirSync(path.join(games, "team-copy"));
    writeFileSync(path.join(games, "team-copy/game.json"), JSON.stringify({ kind: "team" }));
    expect(() => forge.remove("team-copy")).toThrow(/isn't a built game/);
    expect(() => forge.remove("../jobs")).toThrow(/not a game id/);
    expect(() => forge.remove("tap-three")).toThrow(/no built game called tap-three/);
    forge.remove(game);
    expect(existsSync(path.join(games, game))).toBe(false);
    expect(existsSync(path.join(games, "team-copy"))).toBe(true);
    expect(changes).toBe(2);
  }, 30_000);
});

