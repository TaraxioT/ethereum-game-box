// Tap Three's rules: each tap adds one to its seat's count, and the first seat to TARGET wins.
import { stationView, type BuiltEvent, type BuiltRules, type Outcome, type DuelSeat, type StationView } from "@egb/sdk";

export const TARGET = 3;

export interface TapThreeState {
  readonly startedAt: number;
  readonly taps: readonly [number, number];
  readonly winner: DuelSeat | null;
}

function view(state: TapThreeState, seat: DuelSeat): StationView {
  const small = state.winner === null ? "TAP" : state.winner === seat ? "WIN" : "LOSE";
  return stationView(seat === 0 ? "P1" : "P2", String(state.taps[seat]), small);
}

const rules: BuiltRules<TapThreeState> = {
  start: (_seed, now) => ({ startedAt: now, taps: [0, 0], winner: null }),
  step(state, event: BuiltEvent) {
    if (state.winner !== null || event.type !== "tap") return state;
    const taps: [number, number] = [state.taps[0], state.taps[1]];
    taps[event.seat] += 1;
    return { ...state, taps, winner: taps[event.seat] >= TARGET ? event.seat : null };
  },
  outcome: (state): Outcome | null => (state.winner === null ? null : { winner: state.winner }),
  stations: (state) => [view(state, 0), view(state, 1)],
};

export default rules;
