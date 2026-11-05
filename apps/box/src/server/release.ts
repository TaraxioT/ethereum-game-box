// Which commit is running, for /api/health: RELEASE.json at the repo root (written by the Pi's release step), else
// git, else unknown. Read once, after the server is listening.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const COMMIT = /^[0-9a-f]{7,40}$/;

export async function readCommit(repoRoot: string): Promise<string | null> {
  try {
    const release = JSON.parse(await readFile(join(repoRoot, "RELEASE.json"), "utf8")) as { commit?: unknown };
    if (typeof release.commit === "string" && COMMIT.test(release.commit)) return release.commit;
  } catch {
    // No release file: a checkout.
  }
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: repoRoot, timeout: 2_000 }, (error, stdout) => {
      const commit = stdout.trim();
      resolve(!error && COMMIT.test(commit) ? commit : null);
    });
  });
}
