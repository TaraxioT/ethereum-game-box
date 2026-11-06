// A rules child's reply line, checked: the child runs code nobody reviewed, so every line it writes is untrusted
// until it has the runner protocol's shape. A view's text comes through as the game wrote it (the Forge's rules check
// words what doesn't fit a station); the host cuts it to what a station shows (`fitStations`) before anything shows it.
import { MAX_MESSAGE, OVERRIDE_CHARS, printable, stationView, type Outcome, type RunnerReply, type StationView } from "@egb/sdk";

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
  const view: { -readonly [K in keyof StationView]: StationView[K] } = { tag: v.tag, big: v.big, small: v.small };
  // An override that isn't text is left out: the station shows its own default for that moment.
  for (const key of OVERRIDES) {
    const text = v[key];
    if (typeof text === "string") view[key] = text;
  }
  return view;
}

/** Views cut to what a station shows: printable ASCII, each line at its length, overrides at `BIG|small`'s. */
export function fitStations(views: readonly [StationView, StationView]): [StationView, StationView] {
  const fit = (v: StationView): StationView => {
    const extra: Partial<Record<(typeof OVERRIDES)[number], string>> = {};
    for (const key of OVERRIDES) {
      const text = v[key];
      if (text !== undefined) extra[key] = printable(text, OVERRIDE_CHARS);
    }
    return stationView(v.tag, v.big, v.small, extra);
  };
  return [fit(views[0]), fit(views[1])];
}

function stationsOf(v: unknown): Checked<readonly [StationView, StationView]> {
  if (!Array.isArray(v) || v.length !== 2) return bad("stations(state) must return two views: [Player 1's, Player 2's]");
  const [one, two] = [viewOf(v[0]), viewOf(v[1])];
  return one && two ? ok([one, two]) : bad("each station view must have tag, big and small strings (build views with stationView from @egb/sdk)");
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
      return ok({ t: "error", seq, message: typeof raw.message === "string" ? raw.message.slice(0, MAX_MESSAGE) : "an error with no message" });
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
