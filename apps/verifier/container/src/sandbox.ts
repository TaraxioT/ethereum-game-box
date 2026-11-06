// The container's shell: bash as the `agent` user, which isn't the server's user. Other users can't read a process's
// memory or environment through /proc, and the image keeps the server's files from them. The server holds only the
// capabilities `setpriv` needs to make the switch (see the Dockerfile), and the shell keeps none of them.
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { Sandbox } from "./shell.ts";

const AGENT = "agent";
const REAP = fileURLToPath(new URL("reap.ts", import.meta.url));

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

/** Caps on the shell's processes, its open files and the size of any one file, which is what stops a fork bomb. Nothing
 *  here caps memory or the disk: that takes a cgroup, and the server has none of its own. A shell that fills memory kills
 *  the container, which fails the run. One that fills the disk stops its own writes, as the server has none left. */
const BOUNDED = ["prlimit", "--nproc=128", "--nofile=256", `--fsize=${64 * 1024 * 1024}`, "--core=0", "--"] as const;

/** Runs `reap.ts`, which says why the agent can't fight it. It's outside BOUNDED, so a fork bomb at its process limit
 *  can't block it, and it gets no environment, so this process can't show the agent the server's. */
const reap = (): Promise<void> =>
  new Promise((resolve, reject) => {
    spawn(process.execPath, [REAP], { stdio: "ignore", env: {} })
      .on("error", reject)
      .on("close", (code) => (code === 0 ? resolve() : reject(new Error(`reap.ts ended with ${code}`))));
  });

export const agentSandbox: Sandbox = {
  command: (script) => [...BOUNDED, ...AS_AGENT, "bash", "-c", script],
  stop: reap,
};

/** Throws unless the switch of user and the cleanup really work. Without this, a failing `setpriv` would only show up as
 *  shell errors, and the model could still submit a verdict without having read the log. */
export async function checkSandbox(): Promise<void> {
  if (process.getuid?.() === 0) throw new Error("the server is running as root");
  const [file, ...args] = agentSandbox.command("id -un");
  const { stdout } = await promisify(execFile)(file, args, { env: {} });
  if (stdout.trim() !== AGENT) throw new Error(`the shell runs as ${stdout.trim()}`);
  await reap();
}
