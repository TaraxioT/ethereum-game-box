// The model through the Claude Agent SDK, on the Pi's Claude Code login: one single-turn query with no tools, no
// settings, no session on disk and no thinking, answering through structured output (`outputFormat` json_schema), so
// the SDK hands back JSON that matched the schema or an error result.
import type { Options, SDKMessage, query } from "@anthropic-ai/claude-agent-sdk";
import { claudeChildEnv, type Env } from "./claude-env.ts";
import type { BackendCall, ModelBackend } from "./model.ts";

export type QueryFn = typeof query;

/** Structured output arrives as a final tool call the SDK checks: one turn to answer, one retry if it doesn't match. */
const MAX_TURNS = 2;

export function createSdkBackend(env: Env, injected?: QueryFn): ModelBackend {
  // One Claude Code child at a time: each is a few hundred MB on the Pi. A call waits for the slot inside its own
  // deadline (its abort signal fires at the deadline and drops it from the queue).
  let busy = false;
  const waiting: (() => void)[] = [];

  function acquire(signal: AbortSignal): Promise<void> {
    if (!busy) {
      busy = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const take = () => {
        signal.removeEventListener("abort", drop);
        resolve();
      };
      const drop = () => {
        const i = waiting.indexOf(take);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("the model was busy until the deadline"));
      };
      signal.addEventListener("abort", drop, { once: true });
      waiting.push(take);
    });
  }

  function release(): void {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight on; busy stays true
    else busy = false;
  }

  function options(call: BackendCall, abortController: AbortController): Options {
    return {
      model: call.model,
      systemPrompt: call.system,
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      permissionMode: "dontAsk",
      maxTurns: MAX_TURNS,
      outputFormat: { type: "json_schema", schema: call.schema as Record<string, unknown> },
      thinking: { type: "disabled" },
      persistSession: false,
      abortController,
      env: claudeChildEnv(env),
    };
  }

  async function ask(run: QueryFn, call: BackendCall): Promise<unknown> {
    const controller = new AbortController();
    const q = run({ prompt: call.prompt, options: options(call, controller) });
    // close() ends the Claude Code process; an abort alone may leave it finishing its turn.
    const kill = () => {
      controller.abort();
      try {
        q.close();
      } catch {
        // Already gone.
      }
    };
    call.signal.addEventListener("abort", kill, { once: true });
    let value: { v: unknown } | null = null;
    let failure: string | null = null;
    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (msg.type !== "result") continue;
        if (msg.subtype === "success" && !msg.is_error && msg.structured_output !== undefined) value = { v: msg.structured_output };
        else failure = msg.subtype === "success" ? "no structured output" : msg.subtype;
      }
    } catch (err) {
      // A single-shot query throws after an error result; the result's reason is the useful one.
      failure ??= (err as Error).message;
    } finally {
      call.signal.removeEventListener("abort", kill);
    }
    if (value) return value.v;
    kill();
    throw new Error(`the model failed: ${failure ?? "no result"}`);
  }

  return {
    async run(call) {
      await acquire(call.signal);
      try {
        if (call.signal.aborted) throw new Error("the caller gave up");
        const run = injected ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
        return await ask(run, call);
      } finally {
        release();
      }
    },
  };
}
