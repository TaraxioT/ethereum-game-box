// The container's entry point: check the sandbox, serve one job, then exit, so a container is never used twice.
import { tmpdir } from "node:os";

import { LIMITS } from "./limits.ts";
import { agentSandbox, checkSandbox } from "./sandbox.ts";
import { createJobServer } from "./server.ts";

const PORT = 8080;
const DEFAULT_PROXY = "http://zg.internal/v1/chat/completions";

await checkSandbox();

// Node runs as PID 1 here, where a signal with no handler does nothing, and the platform waits 15 minutes for a stop.
process.on("SIGTERM", () => process.exit(0));

createJobServer({
  modelUrl: process.env.ZG_PROXY_URL ?? DEFAULT_PROXY,
  sandbox: agentSandbox,
  limits: LIMITS,
  workRoot: tmpdir(),
  onDone: () => process.exit(0),
}).listen(PORT, "0.0.0.0");
