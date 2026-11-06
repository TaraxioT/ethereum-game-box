// The link's wire messages: JSON over the WebSocket between the Box server and the kiosk screen (LiveLink).
import type { BoxEvent, BoxState, ScreenCommand } from "./types.ts";

/** Server → screen. Every message carries the server's clock, so the screen draws with the link's offset. */
export type LinkDown =
  /** The whole state: on connect, and for state changes with no event (coalesced at 100 ms). */
  | { readonly t: "state"; readonly now: number; readonly state: BoxState }
  /** A moment and the state after it. Never coalesced. */
  | { readonly t: "event"; readonly now: number; readonly state: BoxState; readonly event: BoxEvent };

/** Screen → server. */
export type LinkUp = { readonly t: "command"; readonly command: ScreenCommand };

export const LINK_PATH = "/link";
/** State-only changes are sent at most this often. */
export const LINK_COALESCE_MS = 100;

/**
 * The one core event that goes out as a coalesced `state` message instead of an `event`: the stations' views moving
 * with the clock, which nothing on the screen animates. A `state` message after the first on a connection stands for
 * it, since every other change has already gone out as an `event` carrying the whole state.
 */
export const STATE_ONLY: BoxEvent = { type: "stations" };
