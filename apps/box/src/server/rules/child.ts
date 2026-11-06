// One built game's rules child: `node --permission --allow-fs-read=<rules.js> rules.js`, spoken to in JSON lines over
// stdio. It may read its own bundle and nothing else, and the bundle's jail (builder/bundle/jail.ts) closes what the
// permission model leaves open. The rules host plays matches through it; the Forge's rules check (builder/bundle/
// rules-check.ts) plays its test match through the same child, so a game is checked exactly as it will run.
//
// It gets an empty environment (no key the Box holds, no NODE_OPTIONS to widen its flags). Its memory is capped twice:
// a 64 MB JS heap (a game that allocates objects without end crashes itself), and a resident-memory guard
// (memory.ts) for what the heap flag doesn't count, ArrayBuffers and typed arrays. Either way the match is void
// instead of the kiosk starving on the Pi. stdout is the protocol's: a line that isn't a reply, or one longer than
// MAX_LINE, ends it. What it writes to stderr goes to the caller, which keeps only a capped tail.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { RunnerReply, RunnerRequest } from "@egb/sdk";
import { canGuardMemory, guardMemory, type MemoryGuard } from "./memory.ts";
import { parseReply } from "./reply.ts";

/** Flags before the permission flags. Warnings off: the jail's module hook is still marked experimental. */
export const CHILD_FLAGS = ["--max-old-space-size=64", "--disable-warning=ExperimentalWarning"] as const;

/** The longest reply line: a state the Box sends to the screen many times a second has no business being bigger. */
export const MAX_LINE = 256 * 1024;

/**
 * The Node major whose permission model sandbox.test.ts proved, every refusal included. Node 24's has no network
 * check at all (a rules child could fetch from the Box's own port), so an older Node runs no built game.
 */
export const SANDBOX_NODE_MAJOR = 26;

/** Why this Node can't sandbox a rules child, or null when it can. */
export function sandboxRefusal(version: string = process.versions.node): string | null {
  const major = Number(version.split(".")[0]);
  return major >= SANDBOX_NODE_MAJOR ? null : `built games need Node ${SANDBOX_NODE_MAJOR} or later (this is Node ${version}), whose permission model also refuses the network`;
}

/**
 * The child's command line after its flags: it may read its own file and nothing else. The path is made real first:
 * Node checks the permission against the file's real path, so a symlink anywhere above it would lock the child out of
 * its own program.
 */
export function rulesChildArgs(rulesJs: string): string[] {
  const real = realpathSync(rulesJs);
  return ["--permission", `--allow-fs-read=${real}`, real];
}

export interface ChildEvents {
  reply(reply: RunnerReply): void;
  /** The child crashed, exited, went over its memory, or broke the protocol. It is dead (or being killed). */
  fail(kind: "crash" | "protocol", reason: string): void;
  stderr(text: string): void;
}

export interface RulesChild {
  readonly pid: number | undefined;
  send(request: RunnerRequest): void;
  /** SIGKILL: a child stuck in a loop never gets to run a handler. */
  kill(): void;
}

export function startRulesChild(rulesJs: string, events: ChildEvents): RulesChild {
  const child = spawn(process.execPath, [...CHILD_FLAGS, ...rulesChildArgs(rulesJs)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {},
    cwd: path.dirname(realpathSync(rulesJs)),
  });
  let over = false;
  let pending = "";
  let memory: MemoryGuard | null = null;

  const fail = (kind: "crash" | "protocol", reason: string) => {
    if (over) return;
    over = true;
    memory?.stop();
    child.kill("SIGKILL");
    events.fail(kind, reason);
  };

  if (child.pid !== undefined && canGuardMemory()) {
    memory = guardMemory(child.pid, { over: (bytes) => fail("crash", `used ${Math.round(bytes / 2 ** 20)} MB of memory`) });
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (over) return;
    pending += chunk;
    for (let end = pending.indexOf("\n"); end >= 0 && !over; end = pending.indexOf("\n")) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line.trim()) continue;
      const reply = parseReply(line);
      if (reply.ok) events.reply(reply.value);
      else fail("protocol", `broke the protocol: ${reply.problem}`);
    }
    if (pending.length > MAX_LINE) fail("protocol", `wrote a line over ${MAX_LINE / 1024} KB`);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => events.stderr(text));
  child.on("error", (err) => fail("crash", `couldn't run: ${err.message}`));
  // `close`, not `exit`: by then stdout and stderr are read to the end, so a last reply or error is never lost.
  child.on("close", (code, signal) => fail("crash", signal ? `was killed (${signal})` : `exited (${code})`));
  // A child that died mid-write leaves its stdin broken; the exit above says why.
  child.stdin.on("error", () => {});

  return {
    pid: child.pid,
    send(request) {
      if (!over) child.stdin.write(`${JSON.stringify(request)}\n`);
    },
    kill: () => fail("crash", "was stopped"),
  };
}
