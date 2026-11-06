// The model through the Anthropic Messages API, when the Box has ANTHROPIC_API_KEY: one HTTPS request, no child
// process. The answer is forced through a single tool whose input schema is the answer's schema, so the reply is the
// tool call's input. Errors carry only the HTTP status and the error type: never the key, never the request.
import type { BackendCall, ModelBackend } from "./model.ts";

const URL_MESSAGES = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TOOL = "answer";
/** The answer is a handful of short fields. */
const MAX_TOKENS = 512;

interface ApiReply {
  readonly content?: readonly { readonly type?: string; readonly name?: string; readonly input?: unknown }[];
  readonly error?: { readonly type?: string };
}

export function createApiBackend(apiKey: string, fetchFn: typeof fetch): ModelBackend {
  return {
    async run(call: BackendCall) {
      const res = await fetchFn(URL_MESSAGES, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
        body: JSON.stringify({
          model: call.model,
          max_tokens: MAX_TOKENS,
          system: call.system,
          messages: [{ role: "user", content: call.prompt }],
          tools: [{ name: TOOL, description: "Give the answer.", input_schema: call.schema }],
          tool_choice: { type: "tool", name: TOOL },
        }),
        signal: call.signal,
      });
      const reply = (await res.json().catch(() => ({}))) as ApiReply;
      if (!res.ok) throw new Error(`the model failed: HTTP ${res.status}${reply.error?.type ? ` ${reply.error.type}` : ""}`);
      const use = reply.content?.find((c) => c.type === "tool_use" && c.name === TOOL);
      if (!use) throw new Error("the model failed: no answer");
      return use.input;
    },
  };
}
