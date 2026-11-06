// The agent's folder. It can add files there, as in /tmp, but the sticky bit and the files' modes keep it from changing
// or replacing the two it was given.
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentRunRequest } from "@egb/shared/store";

import { INSTRUCTIONS_FILE, LOG_FILE } from "./prompt.ts";

export async function makeWorkFolder(job: AgentRunRequest, root: string): Promise<string> {
  const folder = await mkdtemp(join(root, "judge-"));
  await writeFile(join(folder, INSTRUCTIONS_FILE), job.instructions, { mode: 0o444 });
  await writeFile(join(folder, LOG_FILE), job.log, { mode: 0o444 });
  await chmod(folder, 0o1777);
  return folder;
}
