// Quick Draw's rules: wait for the sign to flip, then the first chip to touch wins and a touch before the flip loses.
//
// Everything is judged by touch time (`at`), never by the order the Box hears of taps: the two stations and the two
// chips don't finish in step. So the Box waits until the earliest touch is certain:
//   - a chip still being read that touched earlier than the earliest tap may yet be first: wait for its read, at most
//     READ_WAIT_MS from its touch, then judge without it;
//   - a good tap waits SETTLE_MS from its touch for the other station's touch, which may still arrive with an earlier
//     time; both taps in, it is judged at once. A false start is judged at once.
// Nobody touching within TOO_SLOW_MS of the draw stands the standoff again. The speaker never says GO: it lags.
import type { GameRules, Outcome } from "@egb/sdk";
import { hash32, mulberry32 } from "@egb/sdk";
import { other, SEATS, type Seat } from "@egb/sdk";
import type { QuickDrawEvent, QuickDrawState } from "./types.ts";

/** The shortest and longest wait before the sign flips. */
export const MIN_WAIT_MS = 2000;
export const MAX_WAIT_MS = 6000;
/** A good tap waits this long, from its touch, for the other station's touch. */
export const SETTLE_MS = 450;
/** An earlier touch still being read is waited for this long, from its touch. */
export const READ_WAIT_MS = 1500;
/** Nobody touched this long after the draw: the standoff is stood again. */
export const TOO_SLOW_MS = 4000;

type Pair<T> = readonly [T, T];

function put<T>(pair: Pair<T>, seat: Seat, value: T): Pair<T> {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

/** A standoff: the draw comes 2–6 s after `now`, from the seed and the standoff's number. */
function standoff(seed: number, number: number, now: number): QuickDrawState {
  const wait = MIN_WAIT_MS + Math.floor(mulberry32(number === 1 ? seed : hash32(seed, number))() * (MAX_WAIT_MS - MIN_WAIT_MS + 1));
  return {
    phase: "wait",
    seed,
    standoff: number,
    startedAt: now,
    drawAt: now + wait,
    taps: [null, null],
    pending: [null, null],
    winner: null,
    reason: null,
  };
}

/** The sign flips as soon as the clock reaches `drawAt`, whatever event is the first to see it. */
function flipped(state: QuickDrawState, now: number): QuickDrawState {
  return state.phase === "wait" && now >= state.drawAt ? { ...state, phase: "draw" } : state;
}

function decide(state: QuickDrawState, winner: Seat | null, reason: "first" | "early"): QuickDrawState {
  return { ...state, phase: "done", winner, reason, pending: [null, null] };
}

/** Judges the standoff if its earliest touch is certain by `now`; otherwise leaves it waiting. */
function judge(before: QuickDrawState, now: number): QuickDrawState {
  const state = flipped(before, now);
  const tapped = SEATS.filter((seat) => state.taps[seat] !== null);
  if (tapped.length === 0) {
    const reading = state.pending.some((at) => at !== null);
    const slow = state.phase === "draw" && now >= state.drawAt + TOO_SLOW_MS && !reading;
    return slow ? standoff(state.seed, state.standoff + 1, now) : state;
  }
  const at = (seat: Seat): number => state.taps[seat] ?? Infinity;
  const first = tapped.reduce((a, b) => (at(b) < at(a) ? b : a));
  const firstAt = at(first);
  // A chip still being read that touched earlier may be the first.
  const earlier = SEATS.some((seat) => {
    const touched = state.pending[seat];
    return touched !== null && touched < firstAt && now < touched + READ_WAIT_MS;
  });
  if (earlier) return state;
  const both = tapped.length === 2;
  // A dead heat to the millisecond: nobody takes it, both stakes go back.
  if (both && at(0) === at(1)) return decide(state, null, firstAt < state.drawAt ? "early" : "first");
  if (firstAt < state.drawAt) return decide(state, other(first), "early");
  if (both || now >= firstAt + SETTLE_MS) return decide(state, first, "first");
  return state;
}

function step(state: QuickDrawState, event: QuickDrawEvent): QuickDrawState {
  if (state.phase === "done") return state;
  switch (event.type) {
    case "tick":
      return judge(state, event.now);
    case "touch":
      if (event.at < state.startedAt || state.taps[event.seat] !== null || state.pending[event.seat] !== null) return judge(state, event.now);
      return judge({ ...state, pending: put(state.pending, event.seat, event.at) }, event.now);
    case "tap":
      // A chip that touched before this standoff began, or a seat that already tapped, changes nothing.
      if (event.at < state.startedAt || state.taps[event.seat] !== null) return judge(state, event.now);
      return judge({ ...state, taps: put(state.taps, event.seat, event.at), pending: put(state.pending, event.seat, null) }, event.now);
    case "release":
      if (state.pending[event.seat] === null) return judge(state, event.now);
      return judge({ ...state, pending: put(state.pending, event.seat, null) }, event.now);
  }
}

export const rules: GameRules<QuickDrawState, QuickDrawEvent> = {
  start: (seed, now) => standoff(seed, 1, now),
  step,
  outcome(state): Outcome | null {
    return state.phase === "done" ? { winner: state.winner } : null;
  },
};

/** A seat's reaction time: its touch after the draw minus the draw time. null for no tap or a touch before the flip. */
export function reactionMs(state: QuickDrawState, seat: Seat): number | null {
  const tap = state.taps[seat];
  return tap !== null && tap >= state.drawAt ? tap - state.drawAt : null;
}
