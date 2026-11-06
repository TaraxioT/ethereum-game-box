// Environment files: the Pi's `~/.config/egb/env` (or EGB_ENV_FILE), then the repo's `.env`. A key already set wins,
// so systemd, a shell export, or an earlier file always overrides a later one. Values are never printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

/** KEY=value lines; `#` comments, an optional `export `, single or double quotes (double quotes understand \n). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key = "", rest = ""] = match;
    let value = rest;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      // An unquoted value ends at a " #" comment.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

/** Loads `file` into `target` without overriding a key it already has. Returns the keys it set; none for a missing file. */
export function loadEnvFile(file: string, target: Env): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const set: string[] = [];
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (target[key] !== undefined) continue;
    target[key] = value;
    set.push(key);
  }
  return set;
}

/** The env files in the order they are read: EGB_ENV_FILE (default `~/.config/egb/env`), then the repo's `.env`. */
export function envFiles(env: Env, home: string, repoRoot: string): string[] {
  return [env.EGB_ENV_FILE?.trim() || join(home, ".config", "egb", "env"), join(repoRoot, ".env")];
}

/** Loads every env file into `env`; returns the files that set something (paths only). */
export function loadEnv(env: Env, home: string, repoRoot: string): string[] {
  return envFiles(env, home, repoRoot).filter((file) => loadEnvFile(file, env).length > 0);
}
