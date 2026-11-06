// The rules host's contract with the core, against small hand-written children run with the real sandbox flags:
// one request at a time, budgets in wall time, every failure a rejection that ends the session, one game at a time.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BuiltEvent } from "@egb/sdk";
import { tempDir } from "../../builder/forge/test-helpers.ts";
import { sandboxRefusal, SANDBOX_NODE_MAJOR } from "./child.ts";
import { createRulesHost, RulesError, type RulesHost, type RulesHostOptions } from "./host.ts";

const dir = tempDir("egb-rules-host-");

/** A rules child in plain JS: the protocol loop, with `handle(req)` written by the test. */
function child(name: string, handle: string, preamble = 'send({ t: "ready" });'): string {
  const file = path.join(dir, `${name}.mjs`);
  writeFileSync(
    file,
    `const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const views = [{ tag: "P1", big: "TAP", small: "" }, { tag: "P2", big: "WAIT", small: "" }];
const state = (req, extra = {}) => send({ t: "state", seq: req.seq, state: { seq: req.seq, ...extra }, outcome: null, stations: views, ms: 0 });
${preamble}
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { buf += c; for (let i = buf.indexOf("\\n"); i >= 0; i = buf.indexOf("\\n")) { const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); handle(req); } });
process.stdin.on("end", () => process.exit(0));
function handle(req) { ${handle} }
`,
  );
  return file;
}

const GOOD = child("good", "state(req, { event: req.event ?? null });");
const TICK: BuiltEvent = { type: "tick", now: 1_000 };

let host: RulesHost | null = null;

function makeHost(games: Record<string, string>, over: Partial<RulesHostOptions> = {}): { host: RulesHost; logs: string[]; sealed: string[] } {
  const logs: string[] = [];
  const sealed: string[] = [];
  host = createRulesHost({
    locate: (game) => (games[game] ? { rulesJs: games[game], budgetMs: 50 } : null),
    log: (text) => logs.push(text),
    onUnloadable: (game, reason) => sealed.push(`${game}: ${reason}`),
    ...over,
  });
  return { host, logs, sealed };
}

afterEach(() => {
  host?.stop();
  host = null;
});

describe("the rules host", () => {
  it("starts at prepare, then answers start and steps in order with the child's state and views", async () => {
    const { host } = makeHost({ good: GOOD });
    host.prepare("good");
    const first = await host.start("good", 7, 1_000);
    expect(first).toEqual({ state: { seq: 0, event: null }, outcome: null, stations: [{ tag: "P1", big: "TAP", small: "" }, { tag: "P2", big: "WAIT", small: "" }] });
    const steps = await Promise.all([host.step(TICK), host.step({ type: "tap", seat: 1, now: 1_200, roll: null }), host.step(TICK)]);
    expect(steps.map((s) => (s.state as { seq: number }).seq)).toEqual([1, 2, 3]);
    expect((steps[1]?.state as { event: unknown }).event).toEqual({ type: "tap", seat: 1, now: 1_200, roll: null });
  });

  it("cuts station views to what a station shows", async () => {
    const wide = child("wide", 'send({ t: "state", seq: req.seq, state: 1, outcome: { winner: 1 }, stations: [{ tag: "PLAYER", big: "a very very long line indeed", small: "é".repeat(50), done: "X".repeat(80) }, views[1]], ms: 0 });');
    const { host } = makeHost({ wide });
    const snap = await host.start("wide", 1, 0);
    expect(snap.outcome).toEqual({ winner: 1 });
    expect(snap.stations[0]).toEqual({ tag: "PLA", big: "A VERY VERY LONG LINE IN", small: "?".repeat(40), done: "X".repeat(65) });
  });

  it("rejects a step over its budget, kills the child, and rejects what was queued behind it", async () => {
    const slow = child("slow", 'if (req.t === "start") return state(req); const end = Date.now() + 2000; while (Date.now() < end); state(req);');
    const { host, logs } = makeHost({ slow });
    await host.start("slow", 1, 0);
    const t0 = performance.now();
    const late = host.step(TICK);
    const queued = host.step(TICK);
    await expect(late).rejects.toMatchObject({ name: "RulesError", code: "budget" });
    expect(performance.now() - t0).toBeLessThan(1_000);
    await expect(queued).rejects.toMatchObject({ code: "budget" });
    // The session is over: a later step doesn't start it again.
    await expect(host.step(TICK)).rejects.toBeInstanceOf(RulesError);
    expect(logs.join("\n")).toMatch(/slow took over its 50 ms budget \(a tick step\)/);
  });

  it("counts a reply that was already in the pipe while the Box's loop was busy", async () => {
    const { host } = makeHost({ good: GOOD });
    await host.start("good", 1, 0);
    const step = host.step(TICK);
    const end = performance.now() + 150;
    while (performance.now() < end); // the Box's loop, busy past the budget while the child answers
    await expect(step).resolves.toMatchObject({ state: { seq: 1 } });
  });

  it("rejects when the rules throw, crash, exit or break the protocol", async () => {
    const cases: Record<string, [string, string]> = {
      threw: [child("threw", 'req.t === "start" ? state(req) : send({ t: "error", seq: req.seq, message: "Error: boom" });'), "threw"],
      exits: [child("exits", 'req.t === "start" ? state(req) : process.exit(3);'), "crash"],
      garbage: [child("garbage", 'req.t === "start" ? state(req) : process.stdout.write("hello\\n");'), "protocol"],
      order: [child("order", 'state({ seq: req.seq + 5 });'), "protocol"],
      huge: [child("huge", 'req.t === "start" ? state(req) : process.stdout.write("x".repeat(300 * 1024));'), "protocol"],
    };
    for (const [game, [file, code]] of Object.entries(cases)) {
      const { host } = makeHost({ [game]: file });
      const started = host.start(game, 1, 0);
      if (game === "order") {
        await expect(started).rejects.toMatchObject({ code });
        continue;
      }
      await started;
      await expect(host.step(TICK), game).rejects.toMatchObject({ code });
      host.stop();
    }
  });

  it("tells the library about a bundle that never loads, and refuses a game it can't find", async () => {
    const broken = child("broken", "", 'send({ t: "error", seq: null, message: "rules.ts must default-export { start, step, outcome, stations }" });');
    const dies = child("dies", "", "process.exit(1);");
    const { host, sealed } = makeHost({ broken, dies });
    await expect(host.start("broken", 1, 0)).rejects.toMatchObject({ code: "crash" });
    await expect(host.start("dies", 1, 0)).rejects.toMatchObject({ code: "crash" });
    expect(sealed).toEqual(["broken: rules.ts must default-export { start, step, outcome, stations }", "dies: its rules exited (1) before loading"]);
    await expect(host.start("nowhere", 1, 0)).rejects.toMatchObject({ code: "unavailable" });
    await expect(host.step(TICK)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("gives up on a child that never says ready", async () => {
    const mute = child("mute", "state(req);", "");
    const { host, sealed } = makeHost({ mute }, { readyTimeoutMs: 300 });
    await expect(host.start("mute", 1, 0)).rejects.toMatchObject({ code: "crash", message: "didn't start within 0.3 s" });
    expect(sealed).toEqual([]);
  });

  it("runs one game at a time: another game's prepare stops the first, and stop rejects what is pending", async () => {
    const parked = child("parked", 'if (req.t === "start") state(req);');
    const { host } = makeHost({ good: GOOD, parked }, { readyTimeoutMs: 5_000 });
    await host.start("parked", 1, 0);
    host.prepare("parked");
    const pending = host.step(TICK);
    host.prepare("good");
    await expect(pending).rejects.toMatchObject({ code: "stopped" });
    await expect(host.start("good", 1, 0)).resolves.toBeTruthy();
    // A rematch reuses the live child: start again on the same session.
    await expect(host.start("good", 2, 0)).resolves.toMatchObject({ state: { seq: 1 } });
    const last = host.step(TICK);
    host.stop();
    await expect(last).rejects.toMatchObject({ code: "stopped" });
    await expect(host.step(TICK)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("logs the tail of a failing child's stderr, capped, and nothing of a healthy one's", async () => {
    const chatty = child("chatty", 'process.stderr.write("x".repeat(5000) + "\\n"); if (req.t === "step") { process.stderr.write("Error: the lantern broke\\n"); process.exit(2); } state(req);', 'process.stderr.write("hello from the game\\n"); send({ t: "ready" });');
    const { host, logs } = makeHost({ chatty }, { stderrChars: 2_000 });
    await host.start("chatty", 1, 0);
    expect(logs).toEqual([]);
    await expect(host.step(TICK)).rejects.toMatchObject({ code: "crash" });
    const line = logs.find((l) => l.startsWith("rules: chatty exited (2)")) ?? "";
    expect(line).toMatch(/; its stderr ended:\n… \(earlier output dropped\)\nx+\nError: the lantern broke$/);
    expect(line.length).toBeLessThan(2_200);
    expect(line).not.toContain("hello from the game");
  });

  it("runs no built game on a Node whose permission model doesn't cover the network, and seals each one asked for", async () => {
    const { host, logs, sealed } = makeHost({ good: GOOD }, { nodeVersion: "24.11.1" });
    expect(logs).toEqual([`rules: built games need Node ${SANDBOX_NODE_MAJOR} or later (this is Node 24.11.1), whose permission model also refuses the network`]);
    host.prepare("good");
    await expect(host.start("good", 1, 0)).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/^can't run: built games need Node 26/) });
    // Sealed with the reason, at each ask (the library keeps the first).
    expect(new Set(sealed)).toEqual(new Set([`good: ${logs[0]?.slice("rules: ".length)}`]));
    expect(sandboxRefusal("26.0.0")).toBeNull();
    expect(sandboxRefusal(process.versions.node)).toBeNull();
  });
});
