// One call of the agent's shell. Passing the time or output limit stops the call and tells the model so: the run goes
// on, and the run's own limits still hold. Nothing the agent starts outlives its call.
import { type ChildProcess, spawn } from "node:child_process";

import { RunFailure } from "./failure.ts";
import type { Limits } from "./limits.ts";

/** Where the shell runs. In the container that's `agentSandbox`; a test that only needs bash brings its own. */
export interface Sandbox {
  /** The command that runs `bash -c script`. */
  readonly command: (script: string) => readonly [string, ...string[]];
  /** Kills everything the agent has running, resolving once that's done. `shell` is this call's process. */
  readonly stop: (shell: ChildProcess) => Promise<void>;
}

export interface ShellJob {
  readonly sandbox: Sandbox;
  readonly folder: string;
  readonly limits: Pick<Limits, "shellMs" | "shellBytes">;
  /** Aborted when the run ends, which fails the call. */
  readonly signal: AbortSignal;
}

export interface ShellResult {
  readonly output: string;
  readonly exitCode: number | null;
  readonly stopped: "time" | "output" | null;
}

/** All the shell inherits. The server holds no secrets, and this keeps its environment out of the agent's anyway. */
const shellEnv = (folder: string): NodeJS.ProcessEnv => ({
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: folder,
  LANG: "C.UTF-8",
});

export function runShell(script: string, job: ShellJob): Promise<ShellResult> {
  const { sandbox, folder, limits, signal } = job;
  if (signal.aborted) return Promise.reject(new RunFailure("the run timed out"));
  const [file, ...args] = sandbox.command(script);
  return new Promise((resolve, reject) => {
    const shell = spawn(file, args, {
      cwd: folder,
      env: shellEnv(folder),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped: ShellResult["stopped"] = null;
    let stopping = Promise.resolve();

    /** A call ends only after its stops have, or one that ran late would kill the next call. */
    const stopAll = (): void => {
      stopping = stopping.then(() => sandbox.stop(shell));
    };
    const halt = (why: "time" | "output"): void => {
      if (stopped) return;
      stopped = why;
      stopAll();
    };
    const take = (chunk: Buffer): void => {
      const room = limits.shellBytes - size;
      chunks.push(chunk.subarray(0, room));
      size += Math.min(room, chunk.length);
      if (chunk.length > room) halt("output");
    };
    const timer = setTimeout(() => halt("time"), limits.shellMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      stopAll();
      reject(new RunFailure("the run timed out"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    shell.stdout.on("data", take);
    shell.stderr.on("data", take);
    shell.on("error", () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new RunFailure("the shell can't start"));
    });
    // Bash has gone, but anything it left running would hold the pipes open, and `close` would never come.
    shell.on("exit", stopAll);
    shell.on("close", (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      void stopping.then(() => resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode, stopped }));
    });
  });
}

/** A call's result, as the model reads it. */
export function describeResult(result: ShellResult, limits: ShellJob["limits"]): string {
  if (result.stopped === "time") return `${result.output}\n[stopped: past the ${limits.shellMs} ms limit]`;
  if (result.stopped === "output") return `${result.output}\n[stopped: past the ${limits.shellBytes} byte output limit]`;
  return `${result.output}\n[exit code ${result.exitCode}]`;
}
