// The frame channel: a built game's screen runs in <iframe sandbox="allow-scripts"> and only draws. The kiosk posts
// it the state and events; it posts back only readiness and errors. Messages are plain JSON-safe objects.
import type { GameManifest } from "./manifest.ts";
import type { Seat } from "./seat.ts";

export interface FrameSeat {
  /** The badge's label (`NOVA`), or null for an empty seat. */
  readonly name: string | null;
}

/** What happened, so the screen animates the moment rather than diffing states. */
export type FrameEvent =
  | { readonly type: "init" }
  | { readonly type: "step" }
  /** A badge touched a station (before its tap finished). */
  | { readonly type: "touch"; readonly seat: Seat }
  /** A tap finished and the rules took it. */
  | { readonly type: "tap"; readonly seat: Seat }
  | { readonly type: "over" };

export type ToFrame =
  | {
      readonly t: "init";
      readonly manifest: GameManifest;
      readonly seats: readonly [FrameSeat, FrameSeat];
      readonly state: unknown;
      /** The Box's clock (ms since the epoch) when this was sent; the frame keeps the offset to its own. */
      readonly now: number;
      /** prefers-reduced-motion on the kiosk: show end states. */
      readonly calm: boolean;
    }
  | { readonly t: "update"; readonly state: unknown; readonly event: FrameEvent; readonly now: number };

export type FromFrame = { readonly t: "ready" } | { readonly t: "error"; readonly message: string };
