// The live provider: Claude through the Claude Agent SDK, on the Box's Claude Code login. The agent runs with the game
// folder as its cwd, Claude Code's system prompt plus the authoring guide, the five file tools and one MCP tool,
// build_game. A PreToolUse hook and canUseTool both call the one confinement check (confine.ts).
import { readFileSync } from "node:fs";
// The SDK (tens of MB) loads when a build starts, never with the server: these imports are types only.
import type { CanUseTool, HookCallback, Options, Query, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { formatBuild, type BuildCheck } from "./build.ts";
import { checkToolUse, DENIED_TOOLS, FILE_TOOLS } from "./confine.ts";
import { claudeChildEnv, claudeReady, LOGIN_HINT, type Env } from "../llm/claude-env.ts";
import { createEventMapper, resultError, type SdkLikeMessage } from "./events.ts";
import type { AgentProvider, RunContext, RunResult } from "./provider.ts";

const GUIDE = new URL("./authoring.md", import.meta.url);
/** Type-check, bundle and a test match take a few seconds on a Pi; leave room for a slow one. */
const BUILD_TOOL_TIMEOUT_MS = 120_000;

/** The in-process MCP server with the one tool, build_game. */
async function buildServer(build: () => Promise<BuildCheck>) {
  const { createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  return createSdkMcpServer({
    name: "forge",
    version: "1.0.0",
    alwaysLoad: true,
    timeout: BUILD_TOOL_TIMEOUT_MS,
    tools: [
      tool(
        "build_game",
        "Check and bundle this game exactly as the Box will: game.json, a type check, both bundles, a short test match " +
          "of the rules, and the icon. Returns 'Build OK' with the bundle size, or the first errors (file:line:col message). " +
          "Call it after your edits, and again after every fix, until it says Build OK.",
        {},
        async () => {
          const check = await build();
          return { content: [{ type: "text", text: formatBuild(check) }], isError: !check.ok };
        },
      ),
    ],
  });
}

/** One run's options. Exported so a test can check the permission setup without starting anything. */
export async function agentOptions(ctx: RunContext, guide: string, env: Env, abortController: AbortController): Promise<Options> {
  const root = ctx.workDir;
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const verdict = checkToolUse(root, input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
    if (verdict.ok) return {};
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason } };
  };
  const canUseTool: CanUseTool = async (toolName, input) => {
    const verdict = checkToolUse(root, toolName, input);
    return verdict.ok ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: verdict.reason };
  };
  return {
    cwd: root,
    model: ctx.model,
    abortController,
    maxTurns: ctx.maxTurns,
    systemPrompt: { type: "preset", preset: "claude_code", append: guide },
    // The built-in tools the model sees at all.
    tools: [...FILE_TOOLS],
    disallowedTools: DENIED_TOOLS,
    // build_game is not in allowedTools on purpose: an allow rule would skip canUseTool, and every call must pass the
    // same check (which allows it).
    mcpServers: { forge: await buildServer(ctx.build) },
    strictMcpConfig: true,
    // Writes fall through to canUseTool; reads inside cwd are auto-approved, which is why the hook checks them too.
    permissionMode: "default",
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [hook] }] },
    // Never the Box user's settings, CLAUDE.md, plugins or hooks.
    settingSources: [],
    env: claudeChildEnv(env),
    ...(ctx.resume ? { resume: ctx.resume } : {}),
  };
}

/** An API error code from an assistant message, in words for the screen. */
function explain(apiError: string | null, fallback: unknown): string {
  switch (apiError) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return `Claude Code isn't logged in. ${LOGIN_HINT}`;
    case "billing_error":
      return "Claude says this account can't be billed right now.";
    case "rate_limit":
      return "Claude is rate-limited right now; try again in a minute.";
    case "overloaded":
    case "server_error":
      return "Claude is overloaded right now; try again in a minute.";
    case "model_not_found":
      return "The Forge's model isn't available on this account (check FORGE_MODEL).";
    default: {
      const text = fallback instanceof Error ? fallback.message : String(fallback ?? "");
      if (/log ?in|authenticat|credential|api key/i.test(text)) return `Claude Code isn't logged in. ${LOGIN_HINT}`;
      return text.split("\n")[0]?.slice(0, 300) || "The agent stopped with an error.";
    }
  }
}

export function createClaudeProvider(env: Env, o: { readonly query?: typeof sdkQuery } = {}): AgentProvider {
  return {
    id: "claude",
    simulated: false,
    canResume: true,
    ready: () => claudeReady(env),

    async run(ctx: RunContext): Promise<RunResult> {
      const abortController = new AbortController();
      let q: Query | null = null;
      // close() ends the Claude Code process; an abort alone may let it finish its turn.
      const onAbort = () => {
        abortController.abort(ctx.signal.reason);
        q?.close();
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      const mapper = createEventMapper(ctx.workDir);
      let sessionId = ctx.resume;
      let apiError: string | null = null;
      let result: RunResult | null = null;
      try {
        if (ctx.signal.aborted) throw new Error("Stopped.");
        const run = o.query ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
        q = run({ prompt: ctx.prompt, options: await agentOptions(ctx, readFileSync(GUIDE, "utf8"), env, abortController) });
        for await (const message of q) {
          const m = message as unknown as SdkLikeMessage;
          if (typeof m.session_id === "string" && m.session_id) sessionId = m.session_id;
          if (m.type === "assistant" && typeof m.error === "string") apiError = m.error;
          for (const e of mapper.map(m)) ctx.emit(e);
          if (m.type === "result") {
            const ok = m.subtype === "success" && m.is_error !== true;
            result = {
              ok,
              text: ok ? String(m.result ?? "").trim() : explain(apiError, resultError(m)),
              turns: typeof m.num_turns === "number" ? m.num_turns : 0,
              costUsd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
              sessionId,
            };
          }
        }
      } catch (err) {
        // A one-shot query throws after an error result; keep the result it already gave.
        if (!result) {
          const stopped = ctx.signal.aborted || abortController.signal.aborted;
          result = { ok: false, text: stopped ? "Stopped." : explain(apiError, err), turns: 0, costUsd: null, sessionId };
        }
      } finally {
        ctx.signal.removeEventListener("abort", onAbort);
      }
      return result ?? { ok: false, text: explain(apiError, "The agent ended without a result."), turns: 0, costUsd: null, sessionId };
    },
  };
}

