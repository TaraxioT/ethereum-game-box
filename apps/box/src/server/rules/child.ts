// One built game's rules child: `node --permission --allow-fs-read=<rules.js> rules.js` (the Forge's rulesChildArgs),
// spoken to in JSON lines over stdio. It may read its own bundle and nothing else, and the bundle's jail
// (builder/bundle/jail.ts) closes what the permission model leaves open.
//
// It gets an empty environment (no key the Box holds, no NODE_OPTIONS to widen its flags) and a 64 MB heap: a game that
// allocates without end crashes itself (the match is void) instead of starving the kiosk on the Pi. What it writes
// to stderr goes to a capped log; stdout is the protocol's, and a line that isn't a reply, or one longer than
// MAX_LINE, ends it.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import type { RunnerReply, RunnerRequest } from "@egb/sdk";
import { rulesChildArgs } from "../../builder/bundle/rules-check.ts";
import { parseReply } from "./reply.ts";

/** Flags before the permission flags. Warnings off: the jail's module hook is still marked experimental. */
export const CHILD_FLAGS = ["--max-old-space-size=64", "--disable-warning=ExperimentalWarning"] as const;

/** The longest reply line: a state the Box sends to the screen many times a second has no business being bigger. */
export const MAX_LINE = 256 * 1024;

export interface ChildEvents {
  reply(reply: RunnerReply): void;
  /** The child crashed, exited, or broke the protocol. It is dead (or being killed); nothing more comes. */
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

  const fail = (kind: "crash" | "protocol", reason: string) => {
    if (over) return;
    over = true;
    child.kill("SIGKILL");
    events.fail(kind, reason);
  };

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
  child.on("exit", (code, signal) => fail("crash", signal ? `was killed (${signal})` : `exited (${code})`));
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
