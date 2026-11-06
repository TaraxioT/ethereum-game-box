// Quick Draw's rules: wait for the sign to flip, then the first tap wins and a tap before it loses.
import type { GameRules, Outcome } from "@egb/sdk";
import { mulberry32 } from "@egb/sdk";
import { other, type Seat } from "@egb/sdk";
import type { QuickDrawEvent, QuickDrawState } from "./types.ts";

/** The shortest and longest wait before the sign flips. */
export const MIN_WAIT_MS = 2000;
export const MAX_WAIT_MS = 6000;

function withTap(taps: QuickDrawState["taps"], seat: Seat, now: number): QuickDrawState["taps"] {
  if (taps[seat] !== null) return taps;
  return seat === 0 ? [now, taps[1]] : [taps[0], now];
}

/** The sign flips as soon as the clock reaches `drawAt`, whether a tick or a tap is the first to see it. */
function flipped(state: QuickDrawState, now: number): QuickDrawState {
  return state.phase === "wait" && now >= state.drawAt ? { ...state, phase: "draw" } : state;
}

function step(before: QuickDrawState, event: QuickDrawEvent): QuickDrawState {
  if (before.phase === "done") return before;
  const state = flipped(before, event.now);
  if (event.type === "tick") return state;
  const taps = withTap(state.taps, event.seat, event.now);
  if (state.phase === "wait") return { ...state, taps, phase: "done", winner: other(event.seat), reason: "early" };
  return { ...state, taps, phase: "done", winner: event.seat, reason: "first" };
}

export const rules: GameRules<QuickDrawState, QuickDrawEvent> = {
  start(seed, now) {
    const wait = MIN_WAIT_MS + Math.floor(mulberry32(seed)() * (MAX_WAIT_MS - MIN_WAIT_MS + 1));
    return { phase: "wait", startedAt: now, drawAt: now + wait, taps: [null, null], winner: null, reason: null };
  },
  step,
  outcome(state): Outcome | null {
    return state.phase === "done" ? { winner: state.winner } : null;
  },
};

/** A seat's reaction time: its tap after the draw minus the draw time. null for no tap or a tap before the flip. */
export function reactionMs(state: QuickDrawState, seat: Seat): number | null {
  const tap = state.taps[seat];
  return tap !== null && tap >= state.drawAt ? tap - state.drawAt : null;
}
