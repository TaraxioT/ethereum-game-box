// The `sim` provider, SIMULATED: it replays a recorded agent run (sim/run.jsonl) instead of calling a model. Every
// message goes through the same event mapper as a live run, at the recorded pace, and its tool calls really happen:
// each passes the confinement check, its writes and edits land in the game folder, and its build_game call runs the
// real check, whose result replaces the recorded one. So a sim build is a real, playable game (the recorded one, set
// in the template's folder), built and installed exactly like a live one. It is never a fallback for `claude`.
//
// The recording's lines are `{ "ms": delay before this message, "msg": an SDK message }`. In its text, `/GAME` stands
// for the game folder and `$GAME_ID` for the game's id.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatBuild } from "./build.ts";
import { BUILD_TOOL, checkToolUse } from "./confine.ts";
import { createEventMapper, type SdkLikeMessage } from "./events.ts";
import type { AgentProvider, RunContext, RunResult } from "./provider.ts";

const RECORDING = new URL("./sim/run.jsonl", import.meta.url);

interface Entry {
  readonly ms: number;
  readonly msg: SdkLikeMessage;
}

type Block = { readonly type: string; readonly [key: string]: unknown };

/** The recording, set in this game's folder. */
export function loadRecording(workDir: string, gameId: string, file: URL = RECORDING): Entry[] {
  const folder = JSON.stringify(workDir).slice(1, -1);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line.split("/GAME").join(folder).split("$GAME_ID").join(gameId)) as Entry);
}

/** One recorded tool call, done for real in the folder. */
async function perform(ctx: RunContext, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; text?: string }> {
  const verdict = checkToolUse(ctx.workDir, tool, input);
  if (!verdict.ok) return { ok: false, text: verdict.reason };
  const file = typeof input.file_path === "string" ? path.resolve(ctx.workDir, input.file_path) : "";
  switch (tool) {
    case "Write":
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, String(input.content ?? ""));
      return { ok: true };
    case "Edit": {
      const before = readFileSync(file, "utf8");
      const from = String(input.old_string ?? "");
      if (!from || !before.includes(from)) return { ok: false, text: "old_string not found" };
      const to = String(input.new_string ?? "");
      writeFileSync(file, input.replace_all === true ? before.split(from).join(to) : before.replace(from, () => to));
      return { ok: true };
    }
    case BUILD_TOOL: {
      const check = await ctx.build();
      return { ok: check.ok, text: formatBuild(check) };
    }
    default:
      return { ok: true };
  }
}

export function createSimProvider(o: { readonly speed?: number; readonly recording?: URL } = {}): AgentProvider {
  const speed = o.speed ?? 1;
  return {
    id: "sim",
    simulated: true,
    canResume: false,
    ready: () => ({ ok: true, reason: null }),

    async run(ctx: RunContext): Promise<RunResult> {
      const pause = (ms: number) =>
        new Promise<void>((resolve, reject) => {
          if (ctx.signal.aborted) return reject(new Error("stopped"));
          const timer = setTimeout(resolve, ms * speed);
          ctx.signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("stopped"))), { once: true });
        });
      const mapper = createEventMapper(ctx.workDir);
      const done = new Map<string, { ok: boolean; text?: string }>();
      let built = false;
      let buildError = "the recording never called build_game";
      try {
        for (const { ms, msg } of loadRecording(ctx.workDir, ctx.gameId, o.recording)) {
          await pause(ms);
          const blocks = Array.isArray(msg.message?.content) ? (msg.message.content as readonly Block[]) : [];
          if (msg.type === "assistant") {
            for (const e of mapper.map(msg)) ctx.emit(e);
            for (const b of blocks.filter((x) => x.type === "tool_use")) {
              const tool = String(b.name);
              const r = await perform(ctx, tool, (b.input ?? {}) as Record<string, unknown>);
              done.set(String(b.id), r);
              if (tool === BUILD_TOOL) [built, buildError] = [r.ok, r.text?.split("\n")[1] ?? r.text ?? ""];
            }
          } else if (msg.type === "user") {
            // What really happened replaces what the recording says happened.
            const content = blocks.map((b) => (b.type === "tool_result" ? { ...b, is_error: done.get(String(b.tool_use_id))?.ok === false } : b));
            for (const e of mapper.map({ ...msg, message: { content } })) ctx.emit(e);
          } else if (msg.type === "result") {
            const turns = typeof msg.num_turns === "number" ? msg.num_turns : 0;
            if (!built) return { ok: false, text: `The recorded game didn't build: ${buildError}`, turns, costUsd: null, sessionId: null };
            return { ok: true, text: String(msg.result ?? "").trim(), turns, costUsd: null, sessionId: null };
          }
        }
        return { ok: false, text: "The recording ended without a result.", turns: 0, costUsd: null, sessionId: null };
      } catch (err) {
        return { ok: false, text: ctx.signal.aborted ? "Stopped." : `The replay broke: ${(err as Error).message}`, turns: 0, costUsd: null, sessionId: null };
      }
    },
  };
}
