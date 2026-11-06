// A rules child's reply line, checked: the child runs code nobody reviewed, so every line it writes is untrusted
// until it has the runner protocol's shape. Station views are cut to what a station shows on the way in.
import { stationView, type Outcome, type RunnerReply, type StationView } from "@egb/sdk";

const OVERRIDES = ["hold", "sign", "done", "fail"] as const;

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

const ok = <T>(value: T): Checked<T> => ({ ok: true, value });
const bad = (problem: string): Checked<never> => ({ ok: false, problem });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function outcomeOf(v: unknown): Checked<Outcome | null> {
  if (v === null) return ok(null);
  if (isObject(v) && (v.winner === 0 || v.winner === 1 || v.winner === null)) return ok({ winner: v.winner });
  return bad("outcome must be null or { winner: 0 | 1 | null }");
}

function viewOf(v: unknown): StationView | null {
  if (!isObject(v) || typeof v.tag !== "string" || typeof v.big !== "string" || typeof v.small !== "string") return null;
  const extra: Partial<Record<(typeof OVERRIDES)[number], string>> = {};
  for (const key of OVERRIDES) {
    const text = v[key];
    if (typeof text === "string") extra[key] = text.replace(/[^\x20-\x7e]/g, "?").slice(0, 31);
  }
  return stationView(v.tag, v.big, v.small, extra);
}

function stationsOf(v: unknown): Checked<readonly [StationView, StationView]> {
  if (!Array.isArray(v) || v.length !== 2) return bad("stations must be two views");
  const views = [viewOf(v[0]), viewOf(v[1])] as const;
  const [one, two] = views;
  return one && two ? ok([one, two]) : bad("a station view must have tag, big and small strings");
}

/** One stdout line as a reply, or why it isn't one. */
export function parseReply(line: string): Checked<RunnerReply> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return bad(`not JSON: ${line.slice(0, 80)}`);
  }
  if (!isObject(raw)) return bad("a reply must be an object");
  switch (raw.t) {
    case "ready":
      return ok({ t: "ready" });
    case "error": {
      const seq = raw.seq === null || Number.isInteger(raw.seq) ? (raw.seq as number | null) : undefined;
      if (seq === undefined) return bad("an error reply's seq must be a whole number or null");
      return ok({ t: "error", seq, message: typeof raw.message === "string" ? raw.message.slice(0, 300) : "an error with no message" });
    }
    case "state": {
      if (!Number.isInteger(raw.seq)) return bad("a state reply's seq must be a whole number");
      if (!("state" in raw)) return bad("a state reply must carry the state");
      const outcome = outcomeOf(raw.outcome);
      if (!outcome.ok) return outcome;
      const stations = stationsOf(raw.stations);
      if (!stations.ok) return stations;
      const ms = typeof raw.ms === "number" && Number.isFinite(raw.ms) ? raw.ms : 0;
      return ok({ t: "state", seq: raw.seq as number, state: raw.state, outcome: outcome.value, stations: stations.value, ms });
    }
    default:
      return bad(`unknown reply ${JSON.stringify(raw.t)?.slice(0, 20) ?? "without t"}`);
  }
}
