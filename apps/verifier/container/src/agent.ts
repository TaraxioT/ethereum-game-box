// The agent's loop: ask the model, run its shell calls, and repeat until it submits a verdict. Every other ending throws
// a `RunFailure`. The verdict is only a proposal: the Worker checks it, and only the Worker signs.
import type { AgentVerdict } from "@egb/shared/store";

import { askModel, type ChatMessage } from "./chat.ts";
import { RunFailure } from "./failure.ts";
import type { Limits } from "./limits.ts";
import { SYSTEM_PROMPT, taskMessage } from "./prompt.ts";
import { describeResult, runShell, type Sandbox } from "./shell.ts";
import { readCalls, TOOLS } from "./tools.ts";

export interface AgentJob {
  readonly modelUrl: string;
  readonly sandbox: Sandbox;
  readonly limits: Limits;
  /** The work folder, holding the instructions and the log. */
  readonly folder: string;
  /** Aborted if the Worker stops waiting. */
  readonly signal: AbortSignal;
}

export async function runAgent(job: AgentJob): Promise<AgentVerdict> {
  const { modelUrl, sandbox, limits, folder } = job;
  const signal = AbortSignal.any([job.signal, AbortSignal.timeout(limits.runMs)]);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: taskMessage(limits.turns) },
  ];
  let tokens = 0;

  for (let turn = 0; turn < limits.turns; turn++) {
    const reply = await askModel(
      modelUrl,
      {
        messages,
        tools: TOOLS,
        tool_choice: "required",
        max_tokens: limits.replyTokens,
        chat_template_kwargs: { enable_thinking: false },
      },
      AbortSignal.any([signal, AbortSignal.timeout(limits.modelMs)]),
    );
    tokens += reply.tokens;
    if (tokens > limits.tokens) throw new RunFailure("the run passed its token limit");

    const actions = readCalls(reply.calls);
    messages.push({ role: "assistant", content: reply.content, tool_calls: actions.map(({ call }) => call) });
    for (const action of actions) {
      if (action.tool === "submit_verdict") return action.verdict;
      const result = await runShell(action.command, { sandbox, folder, limits, signal });
      messages.push({ role: "tool", tool_call_id: action.call.id, content: describeResult(result, limits) });
    }
  }
  throw new RunFailure("the run passed its turn limit");
}
