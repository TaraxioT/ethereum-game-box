// Turns Agent SDK messages into the ForgeEvents the screen shows: the agent's words (`say`), each tool step with the
// file it touches (`tool`) and whether it worked (`tool_done`). Statuses, compiles and the result come from the job
// runner. Kept structural (no SDK types) so recorded message fixtures and the sim's recording go through it as-is.
import path from "node:path";
import { MAX_SAY_CHARS } from "./limits.ts";
import type { ForgeEventBody } from "./provider.ts";

type Block = { readonly type: string; readonly [key: string]: unknown };

/** The parts of an SDK message the Forge reads. */
export interface SdkLikeMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly message?: { readonly content?: string | readonly Block[] };
  readonly parent_tool_use_id?: string | null;
  readonly session_id?: string;
  readonly [key: string]: unknown;
}

const MAX_PATH = 80;

/** `mcp__forge__build_game` → `build_game`. */
function toolName(tool: string): string {
  return tool.startsWith("mcp__") ? tool.split("__").slice(2).join("__") || tool : tool;
}

/** A file as the players see it: relative to the game folder when inside it, its base name when not. */
function displayPath(root: string, p: unknown): string | null {
  if (typeof p !== "string" || p === "") return null;
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === "") return ".";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return path.basename(abs);
  return rel.split(path.sep).join("/");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What a tool step touches: a file for Read/Write/Edit, the pattern for Glob, the folder or glob for Grep. */
export function toolPath(root: string, tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case "Read":
    case "Write":
    case "Edit":
      return displayPath(root, input.file_path);
    case "Glob":
      return typeof input.pattern === "string" ? clip(input.pattern, MAX_PATH) : null;
    case "Grep":
      return displayPath(root, input.path) ?? (typeof input.glob === "string" ? clip(input.glob, MAX_PATH) : null);
    default:
      return null;
  }
}

/** One mapper per agent run. */
export function createEventMapper(root: string) {
  function map(msg: SdkLikeMessage): ForgeEventBody[] {
    // The agent has no subagents; if one ever shows up, its inner steps aren't the game's story.
    if (msg.parent_tool_use_id) return [];
    const content = msg.message?.content;
    if (!Array.isArray(content)) return [];
    const out: ForgeEventBody[] = [];
    if (msg.type === "assistant") {
      for (const block of content as readonly Block[]) {
        if (block.type === "text") {
          const text = String(block.text ?? "").trim();
          if (text) out.push({ type: "say", text: clip(text, MAX_SAY_CHARS) });
        } else if (block.type === "tool_use") {
          const name = String(block.name);
          const input = (block.input ?? {}) as Record<string, unknown>;
          out.push({ type: "tool", id: String(block.id), name: toolName(name), path: toolPath(root, name, input) });
        }
      }
    } else if (msg.type === "user") {
      for (const block of content as readonly Block[]) {
        if (block.type === "tool_result") out.push({ type: "tool_done", id: String(block.tool_use_id), ok: block.is_error !== true });
      }
    }
    return out;
  }
  return { map };
}

/** Why a run ended badly, from its SDK result message, in words for the screen. */
export function resultError(msg: SdkLikeMessage): string {
  switch (msg.subtype) {
    case "error_max_turns":
      return "The agent ran out of turns before finishing.";
    case "error_max_budget_usd":
      return "The build hit its spending limit.";
    case "success":
      return String(msg.result ?? "").trim() || "The agent stopped with an error.";
    default: {
      const errors = Array.isArray(msg.errors) ? (msg.errors as unknown[]).map(String).filter(Boolean) : [];
      return errors[0] ? clip(errors[0], 300) : "The agent stopped with an error.";
    }
  }
}
