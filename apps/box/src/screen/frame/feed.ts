// What a built game's frame is told, from the Box's state and events. Pure: the view (view.ts) posts what this makes.
import type { FrameEvent, FrameSeat, GameManifest, ToFrame } from "@egb/sdk";
import { badgeLabel } from "../../core/badges.ts";
import type { BoxEvent, BoxState } from "../../core/types.ts";

/** A built game's match as its frame sees it. */
export interface FrameMatch {
  readonly id: string;
  readonly manifest: GameManifest;
  /** The rules' state, as the rules child last returned it. */
  readonly state: unknown;
  /** The match has an outcome. */
  readonly over: boolean;
}

/** Finds the built match in the Box's state, or null while none plays. */
export type FrameSource = (state: BoxState) => FrameMatch | null;

/** Each seat's badge as the frame names it. */
export function frameSeats(state: BoxState): readonly [FrameSeat, FrameSeat] {
  const seat = (i: 0 | 1): FrameSeat => {
    const badge = state.seats[i].badge;
    return { name: badge ? badgeLabel(badge) : null };
  };
  return [seat(0), seat(1)];
}

export function frameInit(match: FrameMatch, state: BoxState, now: number, calm: boolean): Extract<ToFrame, { t: "init" }> {
  return { t: "init", manifest: match.manifest, seats: frameSeats(state), state: match.state, now, calm };
}

/**
 * What happened, for the frame: the match ending, an accepted tap, or the rules' state moving. null when nothing the
 * frame draws changed (the Box's clock, gas, a transaction), so it isn't woken for those.
 */
export function frameEvent(prev: FrameMatch | null, next: FrameMatch, event: BoxEvent): FrameEvent | null {
  if (next.over && !prev?.over) return { type: "over" };
  if (event.type === "tap" && event.accepted) return { type: "tap", seat: event.seat };
  if (next.state !== prev?.state) return { type: "step" };
  return null;
}

export function frameUpdate(prev: FrameMatch | null, next: FrameMatch, event: BoxEvent, now: number): Extract<ToFrame, { t: "update" }> | null {
  const happened = frameEvent(prev, next, event);
  return happened ? { t: "update", state: next.state, event: happened, now } : null;
}
