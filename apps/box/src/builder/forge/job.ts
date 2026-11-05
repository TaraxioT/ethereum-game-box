// One build, start to installed, as the Forge's child process runs it: lay out the folder, run the agent, check the
// game, give a failed check one resumed fix-up turn and a bad icon one more turn (then a plain icon), and install.
// Every moment is a ForgeEvent. A cancel or the time limit stops it until the install begins; from then on it
// finishes, so a game is never left half-installed.
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SdkPaths } from "../bundle/paths.ts";
import type { ForgeEvent, ForgeJob, ForgeProvider, ForgeStatus } from "../types.ts";
import { briefToTask, fixPrompt, iconPrompt } from "./brief.ts";
import { createBuild, type BuildCheck } from "./build.ts";
import { fallbackIcon, ICON_FILE } from "./icon.ts";
import { forgeDirs, installGame } from "./install.ts";
import { MAX_ERROR_LINES } from "./limits.ts";
import type { AgentProvider, ForgeEventBody, RunResult } from "./provider.ts";
import type { ShelfTemplate } from "./shelf.ts";
import { finalizeManifest, prepareWorkspace } from "./workspace.ts";

/** Everything the child needs for one job: plain data, sent over IPC. */
export interface JobSpec {
  readonly job: ForgeJob;
  /** The id the game is installed under (reserved when the job was queued). */
  readonly gameId: string;
  readonly template: ShelfTemplate;
  /** $EGB_DATA. */
  readonly dataDir: string;
  readonly model: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** The sim's pace: 1 replays its recording in real time, 0 at once. */
  readonly simSpeed: number;
}

export interface JobDeps {
  readonly providers: Readonly<Record<ForgeProvider, AgentProvider>>;
  readonly sdk: SdkPaths;
  readonly now: () => number;
}

type Stop = "cancel" | "timeout";

/** Thrown inside a build to end it with words for the screen. */
class BuildStopped extends Error {}

export async function runJob(spec: JobSpec, deps: JobDeps, send: (event: ForgeEvent) => void, cancel: AbortSignal): Promise<void> {
  const { job, gameId } = spec;
  const provider = deps.providers[job.provider];
  // Real paths throughout: the confinement and the rules child's read permission both judge where a path really goes,
  // so a data folder reached through a symlink (macOS's /var is one) must not look like somewhere else.
  mkdirSync(spec.dataDir, { recursive: true });
  const dirs = forgeDirs(realpathSync(spec.dataDir));
  const workDir = path.join(dirs.work, job.id);
  const outDir = path.join(dirs.out, job.id);
  const emit = (body: ForgeEventBody) => send({ ...body, job: job.id, at: deps.now() } as ForgeEvent);
  const status = (s: ForgeStatus, text: string) => emit({ type: "status", status: s, text });
  const stop = new AbortController();
  const onCancel = () => stop.abort("cancel" satisfies Stop);
  cancel.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => stop.abort("timeout" satisfies Stop), spec.timeoutMs);
  let turns = 0;
  let costUsd: number | null = null;
  let sessionId: string | null = null;

  const limit = spec.timeoutMs >= 60_000 ? `${Math.round(spec.timeoutMs / 60_000)} minutes` : `${Math.round(spec.timeoutMs / 1000)} seconds`;
  const stoppedText = () => (stop.signal.reason === "timeout" ? `The build took longer than ${limit}.` : "Cancelled.");
  const checkStop = () => {
    if (stop.signal.aborted) throw new BuildStopped(stoppedText());
  };
  const build = createBuild({ workDir, outDir, gameId, sdk: deps.sdk, emit });
  const turn = async (prompt: string, resume: string | null): Promise<RunResult> => {
    const r = await provider.run({ workDir, gameId, prompt, resume, model: spec.model, maxTurns: spec.maxTurns, signal: stop.signal, emit, build });
    turns += r.turns;
    // A resumed session reports its cost so far, the earlier turns included.
    if (r.costUsd !== null) costUsd = r.costUsd;
    if (r.sessionId) sessionId = r.sessionId;
    checkStop();
    return r;
  };
  const check = async (): Promise<BuildCheck> => {
    status("compiling", "Checking the game");
    const c = await build();
    checkStop();
    return c;
  };
  const fail = (text: string) => {
    status("failed", text);
    emit({ type: "result", ok: false, game: null, error: text });
  };

  try {
    status("preparing", "Setting up the game folder");
    const ready = provider.ready();
    if (!ready.ok) throw new BuildStopped(ready.reason ?? "The Forge can't run on this Box right now.");
    // One build at a time: whatever an earlier build left is no longer anyone's.
    rmSync(dirs.work, { recursive: true, force: true });
    rmSync(dirs.out, { recursive: true, force: true });
    prepareWorkspace({ workDir, template: spec.template, gameId, brief: job.brief, sdkSrc: deps.sdk.src });
    checkStop();

    status("working", provider.simulated ? "SIMULATED · replaying a recorded build, no model" : "Claude is building the game");
    const first = await turn(briefToTask(job.brief, spec.template, gameId), null);
    if (!first.ok) throw new BuildStopped(first.text);

    let result = await check();
    if (!result.ok && provider.canResume && sessionId) {
      status("fixing", "The check failed: one more turn to fix it");
      await turn(fixPrompt(result.errors, MAX_ERROR_LINES), sessionId);
      result = await check();
    }
    if (!result.ok) throw new BuildStopped(`The game didn't build: ${result.errors[0] ?? "unknown error"}`);

    if (result.iconErrors.length > 0 && provider.canResume && sessionId) {
      status("fixing", "One more turn for the game's icon");
      await turn(iconPrompt(result.iconErrors, MAX_ERROR_LINES), sessionId);
      result = await check();
      if (!result.ok) throw new BuildStopped(`The game didn't build: ${result.errors[0] ?? "unknown error"}`);
    }
    if (result.iconErrors.length > 0) {
      writeFileSync(path.join(workDir, ICON_FILE), fallbackIcon());
      status("compiling", `Using a plain icon (${result.iconErrors[0]})`);
    }

    // From here the build is committed: a cancel or the time limit no longer stops it.
    const manifest = finalizeManifest(workDir, job.brief);
    status("installing", `Installing ${manifest.title}`);
    installGame({
      workDir,
      outDir,
      gamesDir: dirs.games,
      gameId,
      provenance: { job: job.id, provider: job.provider, simulated: provider.simulated, model: provider.simulated ? null : spec.model, template: spec.template.id, brief: job.brief, turns, costUsd, builtAt: deps.now() },
    });
    const cost = costUsd !== null ? ` · $${(costUsd as number).toFixed(2)}` : "";
    status("done", `${manifest.title} is ready · ${turns} turns${cost}${provider.simulated ? " · SIMULATED" : ""}`);
    emit({ type: "result", ok: true, game: gameId, error: null });
  } catch (err) {
    fail(err instanceof BuildStopped ? err.message : `The build broke: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener("abort", onCancel);
  }
}
