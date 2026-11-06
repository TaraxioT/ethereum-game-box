// The container's shell: bash as the `agent` user, which isn't the server's user. Other users can't read a process's
// memory or environment through /proc, and the image keeps the server's files from them. The server holds only the
// capabilities `setpriv` needs to make the switch (see the Dockerfile), and the shell keeps none of them.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import type { Sandbox } from "./shell.ts";

const AGENT = "agent";

const AS_AGENT = [
  "setpriv",
  `--reuid=${AGENT}`,
  `--regid=${AGENT}`,
  "--clear-groups",
  "--bounding-set=-all",
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--no-new-privs",
  "--",
] as const;

/** The shell's fork bombs and full disks stop here, ahead of the server's memory and disk. */
const BOUNDED = ["prlimit", "--nproc=128", "--nofile=256", `--fsize=${64 * 1024 * 1024}`, "--core=0", "--"] as const;

export const agentSandbox: Sandbox = {
  command: (script) => [...BOUNDED, ...AS_AGENT, "bash", "-c", script],
  // `kill -1` reaches every process the agent owns, including one that left the shell's process group. It runs outside
  // BOUNDED, so a fork bomb at its process limit can't block it.
  stop: () => {
    const [file, ...args] = AS_AGENT;
    spawn(file, [...args, "bash", "-c", "kill -KILL -1"], { stdio: "ignore" });
  },
};

/** Throws unless the switch of user really works. Without this, a failing `setpriv` would only show up as shell
 *  errors, and the model could still submit a verdict without having read the log. */
export async function checkSandbox(): Promise<void> {
  if (process.getuid?.() === 0) throw new Error("the server is running as root");
  const [file, ...args] = agentSandbox.command("id -un");
  const { stdout } = await promisify(execFile)(file, args);
  if (stdout.trim() !== AGENT) throw new Error(`the shell runs as ${stdout.trim()}`);
}
