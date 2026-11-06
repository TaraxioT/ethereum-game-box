// What the tests share: a sandbox that's only bash, short limits, a work folder and a job.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest } from "@egb/shared/store";
import { afterEach } from "vitest";

import { LIMITS, type Limits } from "../src/limits.ts";
import type { Sandbox } from "../src/shell.ts";
import { makeWorkFolder } from "../src/workdir.ts";

/** Bash as the test's own user: the real sandbox needs the container's users, and `pnpm test:docker` tests that. */
export const bashSandbox: Sandbox = {
  command: (script) => ["/bin/bash", "-c", script],
  stop: async (shell) => {
    try {
      if (shell.pid) process.kill(-shell.pid, "SIGKILL");
    } catch {
      // The group has already gone.
    }
  },
};

export const FAST_LIMITS: Limits = { ...LIMITS, runMs: 5_000, modelMs: 2_000, shellMs: 1_000, shellBytes: 4_096 };

export const JOB: AgentRunRequest = {
  instructions: "Most taps wins the whole pot.",
  log: JSON.stringify({
    header: { players: ["0xa", "0xb"], amount: "5000000" },
    entries: [{ src: "box", t: "tap", seat: 0, at: 1, roll: null }],
  }),
};

const roots: string[] = [];

/** A fresh folder for a test's work folder to go in, removed after the test. */
export async function workRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "egb-agent-test-"));
  roots.push(root);
  return root;
}

export const workFolder = async (job: AgentRunRequest = JOB): Promise<string> => makeWorkFolder(job, await workRoot());

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
