// Shared by the Forge's tests: temp folders, the fixture template's root, briefs, a scripted provider, a launcher
// that runs a job in this process (so a test can script the agent; the real launcher forks child.ts), and a built
// rules.js played in the rules host's own sandboxed child.
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnerReply, RunnerRequest } from "@egb/sdk";
import { startRulesChild } from "../../server/rules/child.ts";
import { sdkPaths } from "../bundle/paths.ts";
import type { ForgeProvider, GameBrief } from "../types.ts";
import { runJob } from "./job.ts";
import type { AgentProvider, RunContext, RunResult } from "./provider.ts";
import type { Launcher } from "./service.ts";
import { createSimProvider } from "./sim.ts";

/** The folder holding the fixture template `tap-three`: a game root, as the server's games folder is. */
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

export function tempDir(prefix = "egb-forge-"): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function brief(over: Partial<GameBrief> = {}): GameBrief {
  return { template: "tap-three", mechanic: "first to three taps", theme: "a pirate ship", twist: null, stakes: [2, 4], voice: "a pirate", title: "Plank Dash", ...over };
}

export type Script = (ctx: RunContext, call: number) => Promise<Partial<RunResult> | void>;

/** A provider whose every run is the test's script. Records each run's context. */
export function scripted(script: Script, o: { readonly canResume?: boolean; readonly ready?: { ok: boolean; reason: string | null } } = {}): AgentProvider & { readonly calls: RunContext[] } {
  const calls: RunContext[] = [];
  return {
    id: "claude",
    simulated: false,
    canResume: o.canResume ?? true,
    calls,
    ready: () => o.ready ?? { ok: true, reason: null },
    async run(ctx) {
      calls.push(ctx);
      const r = (await script(ctx, calls.length)) ?? {};
      return { ok: true, text: "Done.", turns: 3, costUsd: 0.12, sessionId: "session-1", ...r };
    },
  };
}

/** Runs each job in this process with the given providers (the sim's at once unless one is given). */
export function inProcess(providers: Partial<Record<ForgeProvider, AgentProvider>>): Launcher {
  const all = { claude: providers.claude ?? scripted(async () => {}), sim: providers.sim ?? createSimProvider({ speed: 0 }) };
  return (spec, onEvent) => {
    const cancel = new AbortController();
    const done = runJob(spec, { providers: all, sdk: sdkPaths(), now: Date.now }, onEvent, cancel.signal);
    return { cancel: () => cancel.abort(), done };
  };
}

export async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Plays `requests` against a rules.js in the rules host's own child (sandbox flags, memory caps, reply check), sent
 * once it says ready. Resolves with the first `count` replies, `ready` included, and what it wrote to stderr so far.
 */
export function playRules(rulesJs: string, requests: readonly RunnerRequest[], count: number): Promise<{ replies: RunnerReply[]; stderr: () => string }> {
  return new Promise((resolve, reject) => {
    const replies: RunnerReply[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`rules.js didn't answer: ${stderr}`));
    }, 10_000);
    const child = startRulesChild(rulesJs, {
      reply(reply) {
        replies.push(reply);
        if (reply.t === "ready") for (const request of requests) child.send(request);
        if (replies.length < count) return;
        clearTimeout(timer);
        child.kill();
        resolve({ replies, stderr: () => stderr });
      },
      fail(kind, reason) {
        if (replies.length >= count) return;
        clearTimeout(timer);
        reject(new Error(`rules.js ${kind}: ${reason} ${stderr}`));
      },
      stderr: (text) => (stderr += text),
    });
  });
}
