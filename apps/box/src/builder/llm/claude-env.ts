// Can Claude run on this Box, and the environment its Claude Code child gets. The Box uses the Claude Code login on
// the Pi (or an API key / OAuth token in its env file), nothing else. Shared by the model client and the Forge.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Env = Readonly<Record<string, string | undefined>>;

export const LOGIN_HINT = "Log in to Claude Code on the Box: run `claude` once in a terminal.";

export interface ReadyCheck {
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly exists?: (file: string) => boolean;
}

/**
 * Whether Claude has credentials here. On Linux (the Pi) Claude Code keeps its login in
 * `~/.claude/.credentials.json` (or under CLAUDE_CONFIG_DIR); on macOS it lives in the keychain, which can't be checked
 * cheaply, so a Mac is assumed logged in.
 */
export function claudeReady(env: Env, check: ReadyCheck = {}): { readonly ok: boolean; readonly reason: string | null } {
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) return { ok: true, reason: null };
  if ((check.platform ?? process.platform) === "darwin") return { ok: true, reason: null };
  const home = check.home ?? env.HOME ?? os.homedir();
  const file = path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), ".credentials.json");
  return (check.exists ?? existsSync)(file) ? { ok: true, reason: null } : { ok: false, reason: LOGIN_HINT };
}

/** Exact names the Claude Code child may see. */
const PASS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "TEMP", "TMP", "TZ",
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);
/** Name prefixes it may see: its own API settings, the locale, and the XDG dirs (where Linux keeps config). */
const PASS_PREFIX = ["ANTHROPIC_", "LC_", "XDG_"];

/**
 * The Claude Code child's whole environment (the SDK replaces, not merges, when `env` is given). An allowlist, so the
 * Box's own secrets (the relayer key, the RPC URL with its API key, the ElevenLabs key) never reach the model; and
 * nothing that would make the child think it is nested inside another Claude Code session, which it is whenever the
 * Box runs from a developer's Claude Code terminal. The switches keep it lean and private: no memory, no CLAUDE.md,
 * no nonessential traffic.
 */
export function claudeChildEnv(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (value === undefined) continue;
    if (PASS.has(key) || PASS_PREFIX.some((p) => key.startsWith(p))) out[key] = value;
  }
  out.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  out.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  out.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = "1";
  out.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = "1";
  out.CLAUDE_AGENT_SDK_CLIENT_APP = "egb-box/0.1";
  return out;
}
