// The Forge's child process: one build, then it exits. The server forks it with an IPC channel
// (`node apps/box/src/builder/forge/child.ts`), so the agent, the type checker and the bundler never share the
// server's event loop, and the tap path never waits on a build.
//
// Parent → child: `{ t: "run", spec }` once, then `{ t: "cancel" }` at most once.
// Child → parent: `{ t: "event", event }` for every ForgeEvent; the last is the job's `result`.
import { sdkPaths } from "../bundle/paths.ts";
import type { ForgeEvent } from "../types.ts";
import { createClaudeProvider } from "./claude.ts";
import { runJob, type JobSpec } from "./job.ts";
import { createSimProvider } from "./sim.ts";

export type ToChild = { readonly t: "run"; readonly spec: JobSpec } | { readonly t: "cancel" };
export type FromChild = { readonly t: "event"; readonly event: ForgeEvent };

/** Sends one message and waits until it is handed to the channel, so nothing is lost when the child exits. */
function send(message: FromChild): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send || !process.connected) return resolve();
    process.send(message, undefined, {}, () => resolve());
  });
}

async function main(spec: JobSpec, cancel: AbortSignal): Promise<void> {
  const pending: Promise<void>[] = [];
  await runJob(
    spec,
    {
      // The child's own environment is already the allowlist the server forked it with.
      providers: { claude: createClaudeProvider(process.env), sim: createSimProvider({ speed: spec.simSpeed }) },
      sdk: sdkPaths(),
      now: Date.now,
    },
    (event) => void pending.push(send({ t: "event", event })),
    cancel,
  );
  await Promise.all(pending);
}

const cancel = new AbortController();
process.on("message", (raw: unknown) => {
  const message = raw as ToChild;
  if (message.t === "cancel") cancel.abort();
  else if (message.t === "run") {
    main(message.spec, cancel.signal)
      .catch((err) => console.error("[forge] the build crashed:", err))
      // esbuild's service and a closed agent can keep handles open; the job is over, so is the process.
      .finally(() => process.exit(0));
  }
});
// The server went away: nobody is waiting for this build.
process.on("disconnect", () => cancel.abort());
