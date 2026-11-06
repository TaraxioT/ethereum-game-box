// Keeps the agent inside its game folder. Every tool call goes through `checkToolUse` twice: from a PreToolUse hook
// (it runs before anything else, even reads the CLI would auto-approve inside its cwd) and from canUseTool (for what
// falls through to a permission prompt, such as build_game, which is deliberately not pre-allowed).
//
// Reads may go anywhere in the folder, `.reference/` included, except build output (`dist/`, `node_modules/`).
// Writes may not touch `.reference/`, `dist/`, `node_modules/` or `.claude/` (the Box manages those, and `.claude/`
// could carry settings). Globs may not climb out with `..`, start at `~`, or name an absolute path outside. During a
// build the bundle isn't in the folder at all (it is written to the Forge's out folder).
import { realpathSync } from "node:fs";
import path from "node:path";

/** The build tool as the CLI names it: our in-process MCP server is `forge`, the tool `build_game`. */
export const BUILD_TOOL = "mcp__forge__build_game";
/** The built-in tools the agent has. */
export const FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"] as const;
/** Built-in tools taken out of the model's context as well as denied (the check denies anything unlisted anyway). */
export const DENIED_TOOLS = [
  "Bash", "BashOutput", "KillShell", "Monitor", "WebFetch", "WebSearch", "Task", "Agent", "TaskOutput", "TaskStop",
  "NotebookEdit", "TodoWrite", "Skill", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "SlashCommand",
  "ListMcpResourcesTool", "ReadMcpResourceTool", "EnterWorktree", "ExitWorktree", "LSP", "PowerShell", "MultiEdit",
];

const READ_ONLY = new Set([".reference", "dist", "node_modules", ".claude"]);
const UNREADABLE = new Set(["dist", "node_modules"]);

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/**
 * `p` with symlinks resolved in its longest existing prefix: a link inside the folder that points out is judged by
 * where it really goes, and a file not written yet by its real parent.
 */
export function realish(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  for (let head = abs; ; ) {
    try {
      return path.join(realpathSync(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

/** `p` (absolute, or relative to `root`) as a path inside `root` with `/` separators; null when it isn't inside. */
function inside(root: string, p: string): string | null {
  const rel = path.relative(root, realish(path.resolve(root, p)));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** True when `p` is `root` itself or inside it. `root` must already be a real path. */
export function isInside(root: string, p: string): boolean {
  return inside(root, p) !== null;
}

function canRead(root: string, p: string): Verdict {
  const rel = inside(root, p);
  if (rel === null) return no("You can only read the game folder (the docs and the template are in .reference/).");
  const top = rel.split("/")[0] ?? "";
  if (UNREADABLE.has(top)) return no(`${top}/ is build output: build_game tells you what you need.`);
  return OK;
}

function canWrite(root: string, p: string): Verdict {
  const rel = inside(root, p);
  if (rel === null) return no(`You can only write inside the game folder (${root}).`);
  if (rel === "") return no("Write a file, not the folder itself.");
  const top = rel.split("/")[0] ?? "";
  if (READ_ONLY.has(top)) return no(`${top}/ is read-only: the Box manages it.`);
  return OK;
}

/** A glob may not climb out with `..`, start at `~`, or be an absolute pattern whose fixed part is outside. */
function patternStaysInside(root: string, pattern: unknown): Verdict {
  if (pattern === undefined || pattern === null || pattern === "") return OK;
  if (typeof pattern !== "string") return no("Invalid pattern.");
  const parts = pattern.split(/[\\/]/);
  if (parts.includes("..")) return no("Patterns may not use '..'.");
  if (pattern.startsWith("~")) return no("Patterns must stay inside the game folder.");
  if (UNREADABLE.has(parts[0] ?? "")) return no("Build output isn't searchable.");
  if (path.isAbsolute(pattern)) {
    const fixed = pattern.split(/[*?[{]/)[0] ?? "";
    const rel = inside(root, fixed || "/");
    if (rel === null) return no("Patterns must stay inside the game folder.");
    if (UNREADABLE.has(rel.split("/")[0] ?? "")) return no("Build output isn't searchable.");
  }
  return OK;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Whether the agent may run `tool` with `input`, in the game folder `root` (a real path). */
export function checkToolUse(root: string, tool: string, input: Record<string, unknown>): Verdict {
  switch (tool) {
    case BUILD_TOOL:
      return OK;
    case "Read": {
      const p = str(input.file_path);
      return p ? canRead(root, p) : no("Read needs a file_path.");
    }
    case "Write":
    case "Edit": {
      const p = str(input.file_path);
      return p ? canWrite(root, p) : no(`${tool} needs a file_path.`);
    }
    case "Glob":
    case "Grep": {
      const dir = str(input.path);
      if (dir) {
        const v = canRead(root, dir);
        if (!v.ok) return v;
      }
      return patternStaysInside(root, tool === "Glob" ? input.pattern : input.glob);
    }
    default:
      return no(`${tool} isn't available here. Use Read, Write, Edit, Glob, Grep and build_game.`);
  }
}
