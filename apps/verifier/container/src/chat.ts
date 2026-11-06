// One model turn, in the OpenAI chat format, through the Worker's proxy. The proxy adds the key, the model and 0G's
// private mode, and answers an error for a reply it can't prove. There are no retries here: any error fails the run.
import { RunFailure } from "./failure.ts";
import { isRecord } from "./record.ts";

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export type ChatMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls: readonly ToolCall[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly object[];
  readonly tool_choice: "required";
  readonly max_tokens: number;
  /** The model's thinking would spend the reply's tokens before it reached a tool call. */
  readonly chat_template_kwargs: { readonly enable_thinking: false };
}

export interface ChatReply {
  readonly content: string | null;
  /** The reply's tool calls, unchecked: `readCalls` decides what they mean. */
  readonly calls: readonly unknown[];
  /** What this turn spent. */
  readonly tokens: number;
}

/** What a text will cost, at a pessimistic three bytes a token. */
export const estimateTokens = (text: string): number => Math.ceil(Buffer.byteLength(text) / 3);

/** A reply with no usage still counts against the limit, at the estimate. */
function tokensOf(reply: Record<string, unknown>, request: string, text: string): number {
  const total = isRecord(reply.usage) ? reply.usage.total_tokens : undefined;
  return typeof total === "number" ? total : estimateTokens(request) + estimateTokens(text);
}

function parseReply(text: string, request: string): ChatReply {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new RunFailure("the model's reply isn't JSON");
  }
  const choice = isRecord(reply) && Array.isArray(reply.choices) ? reply.choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(reply) || !isRecord(message)) throw new RunFailure("the model's reply has no message");
  return {
    content: typeof message.content === "string" ? message.content : null,
    calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    tokens: tokensOf(reply, request, text),
  };
}

/** Sends `body`, a `ChatRequest` as JSON. */
export async function askModel(url: string, body: string, signal: AbortSignal): Promise<ChatReply> {
  let status: number;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal,
    });
    status = response.status;
    text = await response.text();
  } catch {
    throw new RunFailure(signal.aborted ? "the model timed out" : "the model can't be reached");
  }
  if (status !== 200) throw new RunFailure(`the model answered ${status}`);
  return parseReply(text, body);
}
