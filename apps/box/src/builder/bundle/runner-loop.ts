// The rules runner's loop, inside a built game's rules.js: one request line in, exactly one reply out, in order
// (the runner protocol in @egb/sdk). Pure apart from the clock it measures with, so it is tested without a process.
import type { BuiltEvent, BuiltRules, RunnerReply } from "@egb/sdk";

/** An error message the Box can show and log, never the rules' whole stack. */
const MAX_MESSAGE = 300;

/** True when `value` has the four functions every built game's rules module provides. */
export function isBuiltRules(value: unknown): value is BuiltRules<unknown> {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return ["start", "step", "outcome", "stations"].every((k) => typeof r[k] === "function");
}

function message(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, MAX_MESSAGE);
}

/** A request as it arrives: untrusted until checked. */
function parse(line: string): { t: "start"; seq: number; seed: number; now: number } | { t: "step"; seq: number; event: BuiltEvent } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isInteger(r.seq)) return null;
  const seq = r.seq as number;
  if (r.t === "start" && Number.isInteger(r.seed) && typeof r.now === "number") {
    return { t: "start", seq, seed: r.seed as number, now: r.now };
  }
  if (r.t === "step" && typeof r.event === "object" && r.event !== null) return { t: "step", seq, event: r.event as BuiltEvent };
  return null;
}

/**
 * The loop over one game's rules. `handle` takes one request line and returns the reply. The state lives here between
 * steps; a reply carries it whole, so the Box never keeps a second copy that could drift.
 */
export function createRunnerLoop(rules: BuiltRules<unknown>, clock: () => number = () => performance.now()) {
  let state: unknown;
  let started = false;

  function handle(line: string): RunnerReply {
    const req = parse(line);
    if (!req) return { t: "error", seq: null, message: "unreadable request" };
    if (req.t === "step" && !started) return { t: "error", seq: req.seq, message: "step before start" };
    const t0 = clock();
    try {
      const next = req.t === "start" ? rules.start(req.seed, req.now) : rules.step(state, req.event);
      const outcome = rules.outcome(next);
      const stations = rules.stations(next);
      const ms = clock() - t0;
      state = next;
      started = true;
      return { t: "state", seq: req.seq, state: next, outcome, stations, ms };
    } catch (err) {
      return { t: "error", seq: req.seq, message: message(err) };
    }
  }

  return { handle };
}

/** The reply as one line. A state JSON can't carry (a cycle, a BigInt) becomes an error reply, never a torn line. */
export function encodeReply(reply: RunnerReply): string {
  try {
    return `${JSON.stringify(reply)}\n`;
  } catch (err) {
    const seq = reply.t === "ready" ? null : reply.seq;
    return `${JSON.stringify({ t: "error", seq, message: `the state can't be sent as JSON (${message(err)})` } satisfies RunnerReply)}\n`;
  }
}
