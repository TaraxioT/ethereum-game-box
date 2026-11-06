// The rules runner host: built games' rules, each in its own sandboxed child (child.ts), one game at a time. It is the
// core's RulesRunnerPort on the Pi.
//
// - prepare(game) starts the child at Join, so the first step pays no start-up cost. A different game's child is
//   killed first; the same game's live child is kept (a rematch reuses it).
// - Requests go one at a time: each is written only when the one before it has answered, so a step's time is its own.
// - A step's budget (the manifest's budgetMs) is wall time measured here, from the write to the reply. Over budget,
//   the child is killed. When the budget timer fires, the verdict waits one turn of the event loop (setImmediate runs
//   after the poll phase), so a reply that was already in the pipe while this loop was busy still counts.
// - Any failure (over budget, a throw in the rules, a crash or exit, a protocol break, stop) rejects the call and
//   every call queued behind it, and kills the child: the core then voids the match and refunds both stakes. Nothing
//   restarts by itself; the next prepare or start does.
// - A child that dies, or errors, before it says `ready` couldn't load its bundle: `onUnloadable` tells the library,
//   which seals the game.
// - On a Node whose permission model can't sandbox a child (child.ts, sandboxRefusal), no built game runs: each one
//   asked for is refused and sealed with the reason, before any of its code starts.
// - What a child writes to stderr is kept, capped, and its tail goes into the log line when the child fails: never
//   to the screen, never line by line to the journal.
import type { BuiltEvent, RunnerReply, RunnerRequest } from "@egb/sdk";
import type { RulesRunnerPort, RulesSnapshot } from "../../core/ports.ts";
import { createCappedLog, type CappedLog } from "./capped-log.ts";
import { sandboxRefusal, startRulesChild, type RulesChild } from "./child.ts";
import { fitStations } from "./reply.ts";

/** Where a built game's rules are and how long a step may take, or null for a game that can't run. */
export interface RulesGame {
  readonly rulesJs: string;
  readonly budgetMs: number;
}

export interface RulesHostOptions {
  locate(game: string): RulesGame | null;
  log(text: string): void;
  /** A game whose bundle didn't load in its child. */
  onUnloadable?(game: string, reason: string): void;
  /** How long a child may take to say ready. Node's start on a busy Pi is well under it. */
  readyTimeoutMs?: number;
  /** How much of a child's stderr is kept for the log line when it fails. */
  stderrChars?: number;
  /** The Node version the children run on: this process's (tests: an older one). */
  nodeVersion?: string;
}

export type RulesHost = RulesRunnerPort;

export type RulesFailure = "budget" | "threw" | "crash" | "protocol" | "stopped" | "unavailable";

/** Why a rules call was rejected. Every one voids the match. */
export class RulesError extends Error {
  readonly code: RulesFailure;
  constructor(code: RulesFailure, message: string) {
    super(message);
    this.name = "RulesError";
    this.code = code;
  }
}

type Request = { readonly t: "start"; readonly seed: number; readonly now: number } | { readonly t: "step"; readonly event: BuiltEvent };

interface Call {
  readonly request: Request;
  resolve(snapshot: RulesSnapshot): void;
  reject(error: RulesError): void;
}

interface Session {
  readonly game: string;
  readonly budgetMs: number;
  readonly child: RulesChild | null;
  /** The tail of the child's stderr. */
  readonly stderr: CappedLog;
  ready: boolean;
  /** Set once the session has failed or stopped: the error every later call gets. */
  failed: RulesError | null;
  seq: number;
  readonly queue: Call[];
  inflight: { readonly call: Call; readonly seq: number; readonly timer: NodeJS.Timeout } | null;
  readyTimer: NodeJS.Timeout | null;
}

export const READY_TIMEOUT_MS = 10_000;
/** Enough of a failing child's stderr to see its last error. */
const STDERR_CHARS = 2_000;

const describe = (request: Request): string => (request.t === "start" ? "start" : `a ${request.event.type} step`);

export function createRulesHost(options: RulesHostOptions): RulesHost {
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const stderrChars = options.stderrChars ?? STDERR_CHARS;
  const refusal = sandboxRefusal(options.nodeVersion);
  if (refusal) options.log(`rules: ${refusal}`);
  let session: Session | null = null;

  /** Ends a session: kills its child and rejects everything it still owes. */
  function end(s: Session, error: RulesError): void {
    if (s.failed) return;
    s.failed = error;
    if (s.readyTimer) clearTimeout(s.readyTimer);
    const owed = [...(s.inflight ? [s.inflight.call] : []), ...s.queue.splice(0)];
    if (s.inflight) clearTimeout(s.inflight.timer);
    s.inflight = null;
    s.child?.kill();
    if (error.code !== "stopped") {
      const tail = s.stderr.text().trimEnd();
      options.log(`rules: ${s.game} ${error.message}${tail ? `; its stderr ended:\n${tail}` : ""}`);
    }
    for (const call of owed) call.reject(error);
  }

  function pump(s: Session): void {
    if (s.failed || !s.ready || s.inflight || !s.child) return;
    const call = s.queue.shift();
    if (!call) return;
    const seq = s.seq++;
    const request: RunnerRequest = { ...call.request, seq };
    const timer = setTimeout(() => {
      // The loop may have been busy: let the poll phase deliver a reply already waiting before calling it late.
      setImmediate(() => {
        if (s.inflight?.seq === seq) end(s, new RulesError("budget", `took over its ${s.budgetMs} ms budget (${describe(call.request)})`));
      });
    }, s.budgetMs);
    s.inflight = { call, seq, timer };
    s.child.send(request);
  }

  function onReply(s: Session, reply: RunnerReply): void {
    if (s.failed) return;
    if (reply.t === "ready") {
      if (s.ready) return end(s, new RulesError("protocol", "said ready twice"));
      s.ready = true;
      if (s.readyTimer) clearTimeout(s.readyTimer);
      s.readyTimer = null;
      return pump(s);
    }
    if (reply.t === "error" && reply.seq === null) {
      // Before ready, an error with no request is the bundle refusing to load (no rules exported).
      if (!s.ready) options.onUnloadable?.(s.game, reply.message);
      return end(s, new RulesError(s.ready ? "protocol" : "crash", `couldn't run: ${reply.message}`));
    }
    const sent = s.inflight;
    if (!sent || reply.seq !== sent.seq) return end(s, new RulesError("protocol", `answered request ${reply.seq}, not ${sent?.seq ?? "none"}`));
    if (reply.t === "error") return end(s, new RulesError("threw", `threw: ${reply.message}`));
    clearTimeout(sent.timer);
    s.inflight = null;
    sent.call.resolve({ state: reply.state, outcome: reply.outcome, stations: fitStations(reply.stations) });
    pump(s);
  }

  function open(game: string): Session {
    const base = { game, ready: false, failed: null, seq: 0, queue: [], inflight: null, readyTimer: null, stderr: createCappedLog(stderrChars) };
    const refuse = (why: string): Session => {
      const s: Session = { ...base, budgetMs: 0, child: null };
      end(s, new RulesError("unavailable", why));
      return s;
    };
    const located = options.locate(game);
    if (!located) return refuse("isn't a built game that can run");
    if (refusal) {
      options.onUnloadable?.(game, refusal);
      return refuse(`can't run: ${refusal}`);
    }
    let s: Session | null = null;
    const child = startRulesChild(located.rulesJs, {
      reply: (reply) => s && onReply(s, reply),
      fail: (kind, reason) => {
        if (!s || s.failed) return;
        if (!s.ready) options.onUnloadable?.(game, `its rules ${reason} before loading`);
        end(s, new RulesError(kind, reason));
      },
      stderr: (text) => s?.stderr.append(text),
    });
    s = { ...base, budgetMs: located.budgetMs, child };
    const started = s;
    s.readyTimer = setTimeout(() => end(started, new RulesError("crash", `didn't start within ${readyTimeoutMs / 1000} s`)), readyTimeoutMs);
    return s;
  }

  /** The live session for `game`, opening one (and ending any other) when needed. */
  function sessionFor(game: string): Session {
    if (session && session.game === game && !session.failed) return session;
    if (session) end(session, new RulesError("stopped", "was stopped: another game is starting"));
    session = open(game);
    return session;
  }

  function call(s: Session, request: Request): Promise<RulesSnapshot> {
    if (s.failed) return Promise.reject(s.failed);
    return new Promise<RulesSnapshot>((resolve, reject) => {
      s.queue.push({ request, resolve, reject });
      pump(s);
    });
  }

  return {
    prepare(game) {
      sessionFor(game);
    },
    start(game, seed, now) {
      return call(sessionFor(game), { t: "start", seed, now });
    },
    step(event) {
      if (!session) return Promise.reject(new RulesError("unavailable", "no built game is running"));
      return call(session, { t: "step", event });
    },
    stop() {
      if (session) end(session, new RulesError("stopped", "was stopped"));
      session = null;
    },
  };
}
