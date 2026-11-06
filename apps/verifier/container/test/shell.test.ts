import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { RunFailure } from "../src/failure.ts";
import { runShell, type Sandbox, type ShellJob } from "../src/shell.ts";
import { bashSandbox, FAST_LIMITS, workFolder } from "./fixtures.ts";

async function job(overrides: Partial<ShellJob> = {}): Promise<ShellJob> {
  return {
    sandbox: bashSandbox,
    folder: await workFolder(),
    limits: FAST_LIMITS,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** True while a process with this id exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runShell", () => {
  it("runs in the work folder and returns both streams and the exit code", async () => {
    const result = await runShell("cat instructions.md; echo oops >&2; exit 3", await job());
    expect(result.output).toContain("Most taps wins");
    expect(result.output).toContain("oops");
    expect(result).toMatchObject({ exitCode: 3, stopped: null });
  });

  it("passes the server's environment to no one", async () => {
    process.env.EGB_TEST_CANARY = "canary";
    try {
      const result = await runShell("env", await job());
      expect(result.output).not.toContain("canary");
      expect(result.output).toContain("HOME=");
    } finally {
      delete process.env.EGB_TEST_CANARY;
    }
  });

  it("keeps the agent from changing or replacing its two files", async () => {
    const result = await runShell(
      "echo x > log.json; echo write=$?; echo ok > notes.txt; echo notes=$?; cat notes.txt",
      await job(),
    );
    expect(result.output).toContain("write=1");
    expect(result.output).toContain("notes=0");
    expect(result.output).toContain("ok");
  });

  it("stops a call past its time limit, and kills what it started", async () => {
    const started = Date.now();
    const result = await runShell("sleep 30 & echo $!; wait", await job());
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ exitCode: null, stopped: "time" });
    expect(alive(Number(result.output.trim()))).toBe(false);
  });

  it("stops a call past its output limit, keeping exactly the limit", async () => {
    const result = await runShell("yes 0123456789", await job());
    expect(result.stopped).toBe("output");
    expect(Buffer.byteLength(result.output)).toBe(FAST_LIMITS.shellBytes);
  });

  it("counts stderr against the output limit", async () => {
    const result = await runShell("yes 0123456789 >&2", await job());
    expect(result.stopped).toBe("output");
  });

  it("doesn't wait for a program left running, and kills it", async () => {
    const started = Date.now();
    const result = await runShell("sleep 30 > /dev/null 2>&1 & echo $!", await job());
    expect(Date.now() - started).toBeLessThan(900);
    expect(result).toMatchObject({ exitCode: 0, stopped: null });
    await expect.poll(() => alive(Number(result.output.trim()))).toBe(false);
  });

  it("doesn't wait for a program holding the output open, and kills it", async () => {
    const started = Date.now();
    const result = await runShell("sleep 30 & echo $!", await job());
    expect(Date.now() - started).toBeLessThan(900);
    expect(result).toMatchObject({ exitCode: 0, stopped: null });
    expect(alive(Number(result.output.trim()))).toBe(false);
  });

  it("ends a call only once its cleanup has, so a late kill can't reach the next call", async () => {
    let cleaned = false;
    const stop: Sandbox["stop"] = async (shell) => {
      await delay(100);
      await bashSandbox.stop(shell);
      cleaned = true;
    };
    await runShell("true", await job({ sandbox: { ...bashSandbox, stop } }));
    expect(cleaned).toBe(true);
  });

  it("fails the call when the run ends", async () => {
    const controller = new AbortController();
    const running = runShell("sleep 30", await job({ signal: controller.signal }));
    controller.abort();
    await expect(running).rejects.toThrow(RunFailure);
  });

  it("refuses to start once the run has ended", async () => {
    await expect(runShell("true", await job({ signal: AbortSignal.abort() }))).rejects.toThrow(RunFailure);
  });

  it("fails the call when the shell can't start", async () => {
    const sandbox: Sandbox = { ...bashSandbox, command: () => ["/no/such/shell"] };
    await expect(runShell("true", await job({ sandbox }))).rejects.toThrow("the shell can't start");
  });
});
