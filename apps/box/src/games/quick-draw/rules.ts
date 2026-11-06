// Quick Draw's rules: best of three standoffs. Each is counted in (3, 2, 1), then the sign reads WAIT… and may flash a
// decoy or two; when it flips to DRAW the first chip to touch takes the round, and a touch before the flip (on WAIT or
// on a decoy) is a foul that gives the round to the other seat. The first to take two rounds takes the match.
//
// Everything is judged by touch time (`at`), never by the order the Box hears of taps: the two stations and the two
// chips don't finish in step. So the Box waits until the earliest touch is certain:
//   - a chip still being read that touched earlier than the earliest tap may yet be first: wait for its read, at most
//     READ_WAIT_MS from its touch, then judge without it;
//   - a good tap waits SETTLE_MS from its touch for the other station's touch, which may still arrive with an earlier
//     time; both taps in, it is judged at once. A foul is judged at once.
// A dead heat, or nobody touching within TOO_SLOW_MS of the draw, gives nobody the round and it is played again. After
// MAX_STANDOFFS standoffs the match ends anyway: the one ahead takes it, or it is a draw. The speaker never says GO.
import type { GameRules, Outcome } from "@egb/sdk";
import { hash32, mulberry32 } from "@egb/sdk";
import { other, DUEL_SEATS, type DuelSeat } from "@egb/sdk";
import type { Decoy, QuickDrawEvent, QuickDrawReason, QuickDrawState } from "./types.ts";

/** The shortest and longest wait before the sign flips, from the end of the countdown. */
export const MIN_WAIT_MS = 2000;
export const MAX_WAIT_MS = 6000;
/** A good tap waits this long, from its touch, for the other station's touch. */
export const SETTLE_MS = 450;
/** An earlier touch still being read is waited for this long, from its touch. */
export const READ_WAIT_MS = 1500;
/** Nobody touched this long after the draw: nobody takes the round. */
export const TOO_SLOW_MS = 4000;
/** The countdown before each standoff: three beats of a second. */
export const COUNT_MS = 3000;
/** How long a decided round stays on the screen before the next is counted in. */
export const ROUND_MS = 3200;
/** Rounds to take the match: best of three. */
export const ROUNDS_TO_WIN = 2;
/** Every match ends: after this many standoffs (replays included), the one ahead wins, or it is a draw. */
export const MAX_STANDOFFS = 6;

/** A decoy shows this long. */
export const DECOY_MS = 700;
/** No decoy in the first moment of the wait, and none this close before the real DRAW. */
const DECOY_LEAD_MS = 700;
const DECOY_CLEAR_MS = 800;
/** The gap between two decoys, at least. */
const DECOY_GAP_MS = 500;
/** The chance of a decoy, and of each one after it. */
const DECOY_CHANCE = 0.5;
const MAX_DECOYS = 2;
/** What a decoy says: anything but DRAW. */
export const DECOY_WORDS: readonly string[] = ["DRAG", "DRAT", "DREW", "DRIP", "DRUM"];

type Pair<T> = readonly [T, T];

function put<T>(pair: Pair<T>, seat: DuelSeat, value: T): Pair<T> {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

/** Standoff `number`, counted in from `now`: its wait and its decoys come from the seed and the number. */
function standoff(seed: number, number: number, score: Pair<number>, now: number): QuickDrawState {
  const random = mulberry32(number === 1 ? seed : hash32(seed, number));
  const startedAt = now + COUNT_MS;
  const drawAt = startedAt + MIN_WAIT_MS + Math.floor(random() * (MAX_WAIT_MS - MIN_WAIT_MS + 1));
  const decoys: Decoy[] = [];
  let from = startedAt + DECOY_LEAD_MS;
  while (decoys.length < MAX_DECOYS && random() < DECOY_CHANCE) {
    const room = drawAt - DECOY_CLEAR_MS - DECOY_MS - from;
    if (room < 0) break;
    const at = from + Math.floor(random() * Math.min(room, 1800));
    decoys.push({ at, word: DECOY_WORDS[Math.floor(random() * DECOY_WORDS.length)] ?? "DRAG" });
    from = at + DECOY_MS + DECOY_GAP_MS;
  }
  return {
    phase: "count",
    seed,
    standoff: number,
    round: score[0] + score[1] + 1,
    score,
    countAt: now,
    startedAt,
    drawAt,
    decoys,
    taps: [null, null],
    pending: [null, null],
    winner: null,
    took: null,
    reason: null,
    decidedAt: null,
  };
}

/** The countdown ends and the sign flips as soon as the clock reaches their times, whatever event sees it first. */
function advanced(state: QuickDrawState, now: number): QuickDrawState {
  let next = state;
  if (next.phase === "count" && now >= next.startedAt) next = { ...next, phase: "wait" };
  if (next.phase === "wait" && now >= next.drawAt) next = { ...next, phase: "draw" };
  return next;
}

/** The standoff is decided: a point to `winner`, then the next round, or the end of the match. */
function decide(state: QuickDrawState, winner: DuelSeat | null, reason: QuickDrawReason, now: number): QuickDrawState {
  const score: Pair<number> = winner === null ? state.score : put(state.score, winner, state.score[winner] + 1);
  const base = { ...state, score, took: winner, reason, decidedAt: now, pending: [null, null] as const };
  if (winner !== null && score[winner] >= ROUNDS_TO_WIN) return { ...base, phase: "done", winner };
  if (state.standoff >= MAX_STANDOFFS) return { ...base, phase: "done", winner: score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1 };
  return { ...base, phase: "round", winner };
}

/** Judges the standoff if its earliest touch is certain by `now`; otherwise leaves it waiting. */
function judge(before: QuickDrawState, now: number): QuickDrawState {
  if (before.phase === "round") {
    const next = (before.decidedAt ?? now) + ROUND_MS;
    return now >= next ? standoff(before.seed, before.standoff + 1, before.score, now) : before;
  }
  const state = advanced(before, now);
  const tapped = DUEL_SEATS.filter((seat) => state.taps[seat] !== null);
  if (tapped.length === 0) {
    const reading = state.pending.some((at) => at !== null);
    const slow = state.phase === "draw" && now >= state.drawAt + TOO_SLOW_MS && !reading;
    return slow ? decide(state, null, "slow", now) : state;
  }
  const at = (seat: DuelSeat): number => state.taps[seat] ?? Infinity;
  const first = tapped.reduce((a, b) => (at(b) < at(a) ? b : a));
  const firstAt = at(first);
  // A chip still being read that touched earlier may be the first.
  const earlier = DUEL_SEATS.some((seat) => {
    const touched = state.pending[seat];
    return touched !== null && touched < firstAt && now < touched + READ_WAIT_MS;
  });
  if (earlier) return state;
  const both = tapped.length === 2;
  // A dead heat to the millisecond: nobody takes the round.
  if (both && at(0) === at(1)) return decide(state, null, "heat", now);
  if (firstAt < state.drawAt) return decide(state, other(first), "early", now);
  if (both || now >= firstAt + SETTLE_MS) return decide(state, first, "first", now);
  return state;
}

/** A touch counts from the end of the countdown, once per seat per standoff, and never between rounds. */
function counts(state: QuickDrawState, seat: DuelSeat, at: number): boolean {
  return state.phase !== "round" && at >= state.startedAt && state.taps[seat] === null;
}

function step(state: QuickDrawState, event: QuickDrawEvent): QuickDrawState {
  if (state.phase === "done") return state;
  switch (event.type) {
    case "tick":
      return judge(state, event.now);
    case "touch":
      if (!counts(state, event.seat, event.at) || state.pending[event.seat] !== null) return judge(state, event.now);
      return judge({ ...state, pending: put(state.pending, event.seat, event.at) }, event.now);
    case "tap":
      if (!counts(state, event.seat, event.at)) return judge(state, event.now);
      return judge({ ...state, taps: put(state.taps, event.seat, event.at), pending: put(state.pending, event.seat, null) }, event.now);
    case "release":
      if (state.pending[event.seat] === null) return judge(state, event.now);
      return judge({ ...state, pending: put(state.pending, event.seat, null) }, event.now);
  }
}

export const rules: GameRules<QuickDrawState, QuickDrawEvent> = {
  start: (seed, now) => standoff(seed, 1, [0, 0], now),
  step,
  outcome(state): Outcome | null {
    return state.phase === "done" ? { winner: state.winner } : null;
  },
};

/** A seat's reaction time in the last standoff: its touch after the draw minus the draw time. null for no tap or a
 *  foul. */
export function reactionMs(state: QuickDrawState, seat: DuelSeat): number | null {
  const tap = state.taps[seat];
  return tap !== null && tap >= state.drawAt ? tap - state.drawAt : null;
}

/** The decoy the sign shows at `now`, or null. */
export function decoyAt(state: QuickDrawState, now: number): Decoy | null {
  if (state.phase !== "wait") return null;
  return state.decoys.find((d) => now >= d.at && now < d.at + DECOY_MS) ?? null;
}

/** The seat that fouled in the last standoff, or null. */
export function fouler(state: QuickDrawState): DuelSeat | null {
  return state.reason === "early" && state.took !== null ? other(state.took) : null;
}
