// Quick Draw as a built game: the form the Forge starts a new game from. A standoff: the sign reads WAIT, flips to
// DRAW 2–6 s in (from the seed), and the first badge to touch after the flip wins; a touch before it loses.
//
// Judged by touch time (a tap's `now`), never by the order taps arrive in: the two stations don't finish in step. So a
// good tap waits SETTLE_MS from its touch for the other station's tap, which may still come in with an earlier touch;
// with both in, it is judged at once. A false start is judged at once. Nobody touching within TOO_SLOW_MS of the draw
// stands the standoff again, at most STANDOFFS times; then it is a draw and both stakes go back.
import { hash32, mulberry32, other, DUEL_SEATS, stationView, type BuiltEvent, type BuiltRules, type Outcome, type DuelSeat, type StationView } from "@egb/sdk";

/** The shortest and longest wait before the sign flips. */
export const MIN_WAIT_MS = 2000;
export const MAX_WAIT_MS = 6000;
/** A good tap waits this long, from its touch, for the other station's tap. */
export const SETTLE_MS = 450;
/** Nobody touched this long after the draw: the standoff is stood again. */
export const TOO_SLOW_MS = 4000;
/** Standoffs nobody draws in before the match is called a draw. */
export const STANDOFFS = 3;

export type Phase = "wait" | "draw" | "done";

export interface QuickDrawState {
  readonly phase: Phase;
  readonly seed: number;
  /** 1 for the first standoff. */
  readonly standoff: number;
  readonly startedAt: number;
  /** When the sign flips to DRAW. */
  readonly drawAt: number;
  /** Each seat's touch time, or null. */
  readonly taps: readonly [number | null, number | null];
  /** Set when phase is `done`: null is a draw (both stakes go back). */
  readonly winner: DuelSeat | null;
  /** `first`: the winner touched first after the draw. `early`: the loser touched before it. `slow`: nobody drew. */
  readonly reason: "first" | "early" | "slow" | null;
}

function standoff(seed: number, number: number, now: number): QuickDrawState {
  const wait = MIN_WAIT_MS + Math.floor(mulberry32(hash32(seed, number))() * (MAX_WAIT_MS - MIN_WAIT_MS + 1));
  return { phase: "wait", seed, standoff: number, startedAt: now, drawAt: now + wait, taps: [null, null], winner: null, reason: null };
}

const done = (state: QuickDrawState, winner: DuelSeat | null, reason: "first" | "early" | "slow"): QuickDrawState => ({ ...state, phase: "done", winner, reason });

/** Judges the standoff if its first touch is certain by `now`; otherwise leaves it waiting. */
function judge(before: QuickDrawState, now: number): QuickDrawState {
  const state = before.phase === "wait" && now >= before.drawAt ? { ...before, phase: "draw" as const } : before;
  const tapped = DUEL_SEATS.filter((seat) => state.taps[seat] !== null);
  if (tapped.length === 0) {
    if (state.phase !== "draw" || now < state.drawAt + TOO_SLOW_MS) return state;
    return state.standoff >= STANDOFFS ? done(state, null, "slow") : standoff(state.seed, state.standoff + 1, now);
  }
  const at = (seat: DuelSeat): number => state.taps[seat] ?? Infinity;
  const first = tapped.reduce((a, b) => (at(b) < at(a) ? b : a));
  const firstAt = at(first);
  const both = tapped.length === 2;
  // A dead heat to the millisecond: nobody takes it.
  if (both && at(0) === at(1)) return done(state, null, firstAt < state.drawAt ? "early" : "first");
  if (firstAt < state.drawAt) return done(state, other(first), "early");
  if (both || now >= firstAt + SETTLE_MS) return done(state, first, "first");
  return state;
}

function step(state: QuickDrawState, event: BuiltEvent): QuickDrawState {
  if (state.phase === "done") return state;
  if (event.type === "tick") return judge(state, event.now);
  // A touch from before this standoff began, or a seat's second tap, changes nothing.
  if (event.now < state.startedAt || state.taps[event.seat] !== null) return judge(state, event.now);
  const taps: [number | null, number | null] = [state.taps[0], state.taps[1]];
  taps[event.seat] = event.now;
  return judge({ ...state, taps }, event.now);
}

/** A seat's reaction time: its touch after the draw minus the draw. null for no tap or a touch before the flip. */
export function reactionMs(state: QuickDrawState, seat: DuelSeat): number | null {
  const tap = state.taps[seat];
  return tap !== null && tap >= state.drawAt ? tap - state.drawAt : null;
}

function station(state: QuickDrawState, seat: DuelSeat): StationView {
  const tag = seat === 0 ? "P1" : "P2";
  if (state.phase === "wait") return stationView(tag, "WAIT", "tap on DRAW");
  if (state.phase === "draw") return stationView(tag, state.taps[seat] === null ? "DRAW!" : "WAIT", state.taps[seat] === null ? "tap now" : "judging");
  const ms = reactionMs(state, seat);
  const detail = ms !== null ? `${ms} ms` : state.taps[seat] !== null ? "too early" : "no tap";
  const big = state.winner === null ? "TIE" : state.winner === seat ? "WIN" : "LOSE";
  return stationView(tag, big, detail);
}

const rules: BuiltRules<QuickDrawState> = {
  start: (seed, now) => standoff(seed, 1, now),
  step,
  outcome: (state): Outcome | null => (state.phase === "done" ? { winner: state.winner } : null),
  stations: (state) => [station(state, 0), station(state, 1)],
};

export default rules;
