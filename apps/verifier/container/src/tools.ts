// The agent's two tools, and the checks on the calls the model makes. A call that doesn't fit fails the run: the model
// isn't asked to try again, because the Worker's retry on a fresh container already covers a slip.
import type { AgentVerdict } from "@egb/shared/store";

import type { ToolCall } from "./chat.ts";
import { RunFailure } from "./failure.ts";
import { isRecord } from "./record.ts";

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "shell",
      description: "Run a bash command in the match's folder. Returns its output and exit code.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The command to run." } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_verdict",
      description: "End the run with your verdict. Call it once, alone, after you have checked your numbers.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["split", "cannot_judge"] },
          payouts: {
            type: "array",
            items: { type: "string" },
            description: "With split: each player's payout in USDC base units, as decimal strings, in header.players order.",
          },
          why: { type: "string", description: "A short reason." },
        },
        required: ["kind", "why"],
      },
    },
  },
] as const;

export type Action =
  | { readonly tool: "shell"; readonly call: ToolCall; readonly command: string }
  | { readonly tool: "submit_verdict"; readonly call: ToolCall; readonly verdict: AgentVerdict };

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function readToolCall(input: unknown): ToolCall {
  const fn = isRecord(input) ? input.function : undefined;
  if (!isRecord(input) || typeof input.id !== "string" || input.type !== "function") {
    throw new RunFailure("a malformed tool call");
  }
  if (!isRecord(fn) || typeof fn.name !== "string" || typeof fn.arguments !== "string") {
    throw new RunFailure("a malformed tool call");
  }
  return { id: input.id, type: "function", function: { name: fn.name, arguments: fn.arguments } };
}

function readArguments(call: ToolCall): Record<string, unknown> {
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw new RunFailure("a tool call's arguments aren't JSON");
  }
  if (!isRecord(args)) throw new RunFailure("a tool call's arguments aren't an object");
  return args;
}

function readVerdict(args: Record<string, unknown>): AgentVerdict {
  const { kind, payouts, why } = args;
  if (typeof why !== "string" || why.trim() === "") throw new RunFailure("a verdict with no reason");
  if (kind === "cannot_judge") return { kind, why };
  if (kind !== "split") throw new RunFailure("a verdict of an unknown kind");
  if (!Array.isArray(payouts) || payouts.length === 0) throw new RunFailure("a split with no payouts");
  if (!payouts.every((payout) => typeof payout === "string" && DECIMAL.test(payout))) {
    throw new RunFailure("a split with a payout that isn't a decimal string");
  }
  return { kind, payouts, why };
}

function readAction(input: unknown): Action {
  const call = readToolCall(input);
  const args = readArguments(call);
  if (call.function.name === "submit_verdict") return { tool: "submit_verdict", call, verdict: readVerdict(args) };
  if (call.function.name !== "shell") throw new RunFailure("a call to an unknown tool");
  if (typeof args.command !== "string" || args.command.trim() === "") throw new RunFailure("a shell call with no command");
  return { tool: "shell", call, command: args.command };
}

/** What one reply asks for. A reply must make a call, and a verdict must stand alone: one sent beside a shell call was
 *  written before that call's output came back. */
export function readCalls(calls: readonly unknown[]): readonly Action[] {
  if (calls.length === 0) throw new RunFailure("a reply with no tool call");
  const actions = calls.map(readAction);
  if (actions.length > 1 && actions.some((action) => action.tool === "submit_verdict")) {
    throw new RunFailure("a verdict sent beside another call");
  }
  return actions;
}
