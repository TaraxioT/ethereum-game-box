// The Forge as the server mounts it: a small service that queues builds and runs one at a time, each in its own child
// process (child.ts), and streams their ForgeEvents to whoever subscribes, with a replay for a screen that subscribes
// late. It keeps every job's record in $EGB_DATA/forge/jobs/ so the list survives a restart. It never loads the
// agent SDK, the bundler or the type checker itself: those live in the child.
import { fork } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ForgeEvent, ForgeJob, ForgeProvider, GameBrief } from "../types.ts";
import { briefProblem } from "./brief.ts";
import type { FromChild, ToChild } from "./child.ts";
import { claudeChildEnv, claudeReady, type Env } from "../llm/claude-env.ts";
import { forgeDirs, removeGame } from "./install.ts";
import type { JobSpec } from "./job.ts";
import { FORGE_MODEL, KILL_GRACE_MS, MAX_EVENTS, MAX_JOBS_KEPT, MAX_TURNS, TIMEOUT_MS } from "./limits.ts";
import { readShelf, type ShelfTemplate } from "./shelf.ts";
import { newGameId } from "./slug.ts";

const CHILD = fileURLToPath(new URL("./child.ts", import.meta.url));
/**
 * The build's niceness. Its type checks, bundles and agent yield the Pi's cores to the server and the kiosk (the
 * server runs at -5), and everything it starts inherits it.
 */
const BUILD_NICE = 10;
/** How long stop() waits for a running build to wind down before it kills it. */
const STOP_WAIT_MS = 10_000;
const PROVIDERS: readonly ForgeProvider[] = ["claude", "sim"];

/** A request the Forge refuses (a bad brief, an unknown provider, a game it won't remove): the caller's to fix. */
export class ForgeRequestError extends Error {}

/** A running build, however it runs. */
export interface Launch {
  cancel(): void;
  /** Settles when the build's process has gone. */
  readonly done: Promise<void>;
}
export type Launcher = (spec: JobSpec, onEvent: (event: ForgeEvent) => void) => Launch;

export interface ForgeConfig {
  /** $EGB_DATA: jobs, work and out under forge/, installed games under games/. */
  readonly dataDir: string;
  /** Folders whose game folders may be templates (the team games' folder, at least). */
  readonly gameRoots: readonly string[];
  /** The Box's environment: FORGE_MODEL and FORGE_TIMEOUT_MS, and the Claude login the child may see. */
  readonly env: Env;
  /** The sim's pace: 1 replays in real time (the default), 0 at once. */
  readonly simSpeed?: number;
  /** How a build runs: by default, a forked child.ts. */
  readonly launch?: Launcher;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly log?: (line: string) => void;
  /** A game was installed or removed: the library rescans. */
  readonly onLibraryChange?: () => void;
  /** The Designer's edit lock: held from the moment a brief is accepted until its build ends. */
  readonly lock?: { hold(): () => void };
}

export interface ForgeService {
  /** The templates a brief may start from. */
  shelf(): readonly ShelfTemplate[];
  /** Whether a provider can build on this Box right now, and why not. */
  ready(provider: ForgeProvider): { readonly ok: boolean; readonly reason: string | null };
  /** Queues a build. Throws ForgeRequestError for a brief or provider it can't take. */
  submit(brief: GameBrief, provider: ForgeProvider): ForgeJob;
  /** Every job kept, newest first. */
  list(): readonly ForgeJob[];
  get(id: string): ForgeJob | null;
  /** A job's events so far, oldest first. */
  events(id: string): readonly ForgeEvent[];
  /** Every event of every job from now on; with `replay`, that job's events so far first. */
  subscribe(listener: (event: ForgeEvent) => void, o?: { readonly replay?: string }): () => void;
  /** Stops a queued or running build. False when it is installing or already over. */
  cancel(id: string): boolean;
  /** Deletes an installed built game. Never a team game. */
  remove(game: string): void;
  /** Stops the running build (if any) and saves every record. */
  stop(): Promise<void>;
}

type MutableJob = { -readonly [K in keyof ForgeJob]: ForgeJob[K] };

interface JobRecord {
  readonly v: 1;
  readonly job: MutableJob;
  /** The id reserved for the game; `job.game` is set to it once installed. */
  readonly gameId: string;
  readonly events: ForgeEvent[];
}

const FINISHED = new Set(["done", "failed"]);
const COMMITTED = new Set(["installing", "done", "failed"]);

/**
 * The default launcher: a forked child in its own process group. It gets the same allowlisted environment as the
 * Claude Code process under it (path, home, locale, the Claude login): the Box's other keys never reach a build.
 */
export function forkLauncher(env: Env, log: (line: string) => void): Launcher {
  return (spec, onEvent) => {
    const child = fork(CHILD, [], {
      execArgv: [],
      env: claudeChildEnv(env),
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "json",
      // Its own group, so a kill takes the Claude Code process under it too.
      detached: true,
    });
    try {
      if (child.pid) os.setPriority(child.pid, BUILD_NICE);
    } catch {
      // Not allowed here: the build just runs at the server's priority.
    }
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    let grace: ReturnType<typeof setTimeout> | undefined;
    // The child keeps its own time limit; this is the backstop for a child that can't.
    const backstop = setTimeout(() => {
      log(`[forge] ${spec.job.id} ran past its limit: killing it`);
      killGroup();
    }, spec.timeoutMs + KILL_GRACE_MS);
    child.on("message", (m: unknown) => {
      const message = m as FromChild;
      if (message.t === "event") onEvent(message.event);
    });
    const done = new Promise<void>((resolve) => {
      const end = () => {
        clearTimeout(backstop);
        clearTimeout(grace);
        killGroup();
        resolve();
      };
      child.on("exit", end);
      child.on("error", (err) => {
        log(`[forge] couldn't run a build: ${err.message}`);
        end();
      });
    });
    child.send({ t: "run", spec } satisfies ToChild);
    return {
      cancel() {
        if (child.connected) child.send({ t: "cancel" } satisfies ToChild);
        grace ??= setTimeout(killGroup, KILL_GRACE_MS);
      },
      done,
    };
  };
}

export function createForge(config: ForgeConfig): ForgeService {
  const now = config.now ?? Date.now;
  const random = config.random ?? Math.random;
  const log = config.log ?? ((line: string) => console.log(line));
  const env = config.env;
  const model = env.FORGE_MODEL || FORGE_MODEL;
  const timeoutMs = Number(env.FORGE_TIMEOUT_MS) || TIMEOUT_MS;
  const launch = config.launch ?? forkLauncher(env, log);
  const dirs = forgeDirs(config.dataDir);
  const records = new Map<string, JobRecord>();
  const queue: string[] = [];
  const listeners = new Set<(event: ForgeEvent) => void>();
  const saving = new Map<string, Promise<void>>();
  /** Each unfinished job's hold on the Designer's lock. */
  const holds = new Map<string, () => void>();
  const hold = (id: string) => {
    if (config.lock) holds.set(id, config.lock.hold());
  };
  let active: { readonly id: string; readonly run: Launch } | null = null;
  let stopped = false;

  // ---- records on disk -----------------------------------------------------------------------------------------

  const fileOf = (id: string) => path.join(dirs.jobs, `${id}.json`);

  /** Writes a record (temp file, then rename), one write per job at a time. */
  function save(rec: JobRecord): void {
    const id = rec.job.id;
    const text = JSON.stringify(rec);
    const next = (saving.get(id) ?? Promise.resolve()).then(async () => {
      const tmp = `${fileOf(id)}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, fileOf(id));
    });
    saving.set(
      id,
      next.catch((err) => log(`[forge] couldn't save ${id}: ${(err as Error).message}`)),
    );
  }

  function prune(): void {
    const finished = [...records.values()].filter((r) => FINISHED.has(r.job.status)).sort((a, b) => a.job.createdAt - b.job.createdAt);
    while (finished.length > MAX_JOBS_KEPT) {
      const old = finished.shift()!;
      records.delete(old.job.id);
      void rm(fileOf(old.job.id), { force: true });
    }
  }

  function load(): void {
    mkdirSync(dirs.jobs, { recursive: true });
    const loaded: JobRecord[] = [];
    for (const name of readdirSync(dirs.jobs)) {
      if (!name.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(readFileSync(path.join(dirs.jobs, name), "utf8")) as JobRecord;
        if (rec.v === 1 && typeof rec.job?.id === "string" && Array.isArray(rec.events)) loaded.push(rec);
      } catch {
        // A torn or foreign file isn't a job.
      }
    }
    for (const rec of loaded.sort((a, b) => a.job.createdAt - b.job.createdAt)) {
      records.set(rec.job.id, rec);
      if (rec.job.status === "queued") {
        queue.push(rec.job.id);
        hold(rec.job.id);
      }
      else if (!FINISHED.has(rec.job.status)) {
        // A build the restart cut off. If its install had already landed, the game is there.
        const installed = existsSync(path.join(dirs.games, rec.gameId, "game.json"));
        finish(rec, installed ? null : "The Box restarted during this build.");
      }
    }
    prune();
  }

  // ---- events --------------------------------------------------------------------------------------------------

  function publish(event: ForgeEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        log(`[forge] an event listener failed: ${(err as Error).message}`);
      }
    }
  }

  function record(rec: JobRecord, event: ForgeEvent): void {
    rec.events.push(event);
    if (rec.events.length > MAX_EVENTS) rec.events.splice(1, rec.events.length - MAX_EVENTS);
    // A job ends with its result: status, game and error change together, never `done` with no game yet.
    if (event.type === "status" && !FINISHED.has(event.status)) rec.job.status = event.status;
    if (event.type === "result") {
      rec.job.status = event.ok ? "done" : "failed";
      rec.job.game = event.game;
      rec.job.error = event.error;
      holds.get(rec.job.id)?.();
      holds.delete(rec.job.id);
    }
    if (event.type === "status" || event.type === "result") save(rec);
    publish(event);
    // The game is in place before its result is sent: the cartridge can slide in now.
    if (event.type === "result" && event.ok && active?.id === rec.job.id) config.onLibraryChange?.();
  }

  /** Ends a job from the parent's side (cancelled while queued, a lost child, a restart). null: it installed. */
  function finish(rec: JobRecord, error: string | null): void {
    const at = now();
    const job = rec.job.id;
    if (error === null) {
      record(rec, { type: "status", job, at, status: "done", text: "Installed" });
      record(rec, { type: "result", job, at, ok: true, game: rec.gameId, error: null });
    } else {
      record(rec, { type: "status", job, at, status: "failed", text: error });
      record(rec, { type: "result", job, at, ok: false, game: null, error });
    }
  }

  // ---- the queue -----------------------------------------------------------------------------------------------

  function pump(): void {
    if (active || stopped) return;
    const id = queue.shift();
    if (!id) return;
    const rec = records.get(id);
    if (!rec || rec.job.status !== "queued") return pump();
    const template = readShelf(config.gameRoots).find((t) => t.id === rec.job.brief.template);
    if (!template) {
      finish(rec, `The template "${rec.job.brief.template}" is no longer on the shelf.`);
      return pump();
    }
    const spec: JobSpec = { job: { ...rec.job }, gameId: rec.gameId, template, dataDir: config.dataDir, model, maxTurns: MAX_TURNS, timeoutMs, simSpeed: config.simSpeed ?? 1 };
    const run = launch(spec, (event) => record(rec, event));
    active = { id, run };
    void run.done.then(() => {
      if (!FINISHED.has(rec.job.status)) finish(rec, "The build stopped unexpectedly.");
      active = null;
      prune();
      pump();
    });
  }

  // ---- the service ---------------------------------------------------------------------------------------------

  const copy = (job: ForgeJob): ForgeJob => ({ ...job });

  load();
  // Builds queued before a restart go on now.
  pump();

  return {
    shelf: () => readShelf(config.gameRoots),

    ready: (provider) => (provider === "claude" ? claudeReady(env) : { ok: true, reason: null }),

    submit(brief, provider) {
      if (stopped) throw new ForgeRequestError("The Forge is stopped.");
      if (!PROVIDERS.includes(provider)) throw new ForgeRequestError(`Unknown Forge provider "${String(provider)}".`);
      const shelf = readShelf(config.gameRoots);
      const problem = briefProblem(brief, shelf);
      if (problem) throw new ForgeRequestError(problem);
      const template = shelf.find((t) => t.id === brief.template)!;
      const taken = (id: string) =>
        existsSync(path.join(dirs.games, id)) || shelf.some((t) => t.id === id) || [...records.values()].some((r) => r.gameId === id);
      const gameId = newGameId(brief.title ?? brief.theme ?? template.title, taken, random);
      const at = now();
      const job: MutableJob = {
        id: `job-${at.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`,
        brief: structuredClone(brief),
        provider,
        status: "queued",
        createdAt: at,
        game: null,
        error: null,
      };
      const rec: JobRecord = { v: 1, job, gameId, events: [] };
      records.set(job.id, rec);
      queue.push(job.id);
      hold(job.id);
      record(rec, { type: "status", job: job.id, at, status: "queued", text: active ? "Waiting for the build before it" : "Starting" });
      pump();
      return copy(job);
    },

    list: () => [...records.values()].map((r) => copy(r.job)).sort((a, b) => b.createdAt - a.createdAt),

    get: (id) => {
      const rec = records.get(id);
      return rec ? copy(rec.job) : null;
    },

    events: (id) => [...(records.get(id)?.events ?? [])],

    subscribe(listener, o = {}) {
      for (const event of o.replay ? (records.get(o.replay)?.events ?? []) : []) listener(event);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    cancel(id) {
      const rec = records.get(id);
      if (!rec || COMMITTED.has(rec.job.status)) return false;
      const queued = queue.indexOf(id);
      if (queued >= 0) {
        queue.splice(queued, 1);
        finish(rec, "Cancelled.");
        return true;
      }
      if (active?.id !== id) return false;
      active.run.cancel();
      return true;
    },

    remove(game) {
      if ([...records.values()].some((r) => r.gameId === game && !FINISHED.has(r.job.status))) {
        throw new ForgeRequestError(`${game} is being built right now.`);
      }
      try {
        removeGame(dirs.games, game);
      } catch (err) {
        throw new ForgeRequestError((err as Error).message);
      }
      config.onLibraryChange?.();
    },

    async stop() {
      stopped = true;
      const current = active;
      if (current) {
        current.run.cancel();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([current.run.done, new Promise((resolve) => (timer = setTimeout(resolve, STOP_WAIT_MS)))]);
        clearTimeout(timer);
      }
      await Promise.all(saving.values());
    },
  };
}
