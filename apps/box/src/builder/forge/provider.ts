// A Forge provider runs the agent that writes a game. The job runner (job.ts) owns everything around it: the folder,
// the checks, the fix-up turn, the install. A provider only turns a task into edits in `workDir` and reports what it
// did as ForgeEvents.
import type { ForgeEvent, ForgeProvider } from "../types.ts";
import type { BuildCheck } from "./build.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A ForgeEvent before the runner stamps its job and time. */
export type ForgeEventBody = DistributiveOmit<ForgeEvent, "job" | "at">;

export interface RunContext {
  /** The game folder (a real path): the agent's cwd, which it may not leave. */
  readonly workDir: string;
  /** The game's id (the sim's recording names it in the files it writes). */
  readonly gameId: string;
  /** This turn: the whole task for the first, the errors for a fix-up. */
  readonly prompt: string;
  /** The session to continue (a fix-up turn), or null for a fresh one. */
  readonly resume: string | null;
  readonly model: string;
  readonly maxTurns: number;
  /** Aborted on cancel and on the time limit. */
  readonly signal: AbortSignal;
  emit(event: ForgeEventBody): void;
  /** The build_game tool: checks and bundles the folder now, and emits `compile` events. */
  build(): Promise<BuildCheck>;
}

export interface RunResult {
  readonly ok: boolean;
  /** The agent's closing summary, or why it failed. */
  readonly text: string;
  readonly turns: number;
  readonly costUsd: number | null;
  /** The session a fix-up turn resumes; null when the provider can't resume. */
  readonly sessionId: string | null;
}

export interface AgentProvider {
  readonly id: ForgeProvider;
  /** A replay, not a model: its status says SIMULATED. */
  readonly simulated: boolean;
  /** It can take another turn in the same session (the fix-up turns). */
  readonly canResume: boolean;
  /** Whether builds can run at all on this Box, and why not. */
  ready(): { readonly ok: boolean; readonly reason: string | null };
  run(ctx: RunContext): Promise<RunResult>;
}
