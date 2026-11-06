// The frame channel: a built game's screen runs in <iframe sandbox="allow-scripts"> and only draws. The kiosk posts
// it the state and events; it posts back only readiness and errors. A store bundle's page runs in the same sandbox and
// has a few more words: the kiosk tells it its players and each tap, and it may post events for the log, a line for a
// station, a buzz and its end. Messages are plain JSON-safe objects.
import type { GameManifest } from "./manifest.ts";
import { LOG_LIMITS } from "./match-log.ts";
import type { DuelSeat, Seat } from "./seat.ts";

export interface FrameSeat {
  /** The badge's label (`NOVA`), or null for an empty seat. */
  readonly name: string | null;
}

/** A store match's player, as a bundle's page hears them. */
export interface BundlePlayer extends FrameSeat {
  /**
   * Where they stand at the Box: its screen and their station call them Player `boxSeat + 1`, in that seat's colour. A
   * page counts players by place, and names and colours them by this, so a seat left empty can't shift them.
   */
  readonly boxSeat: Seat;
}

/** What happened, so the screen animates the moment rather than diffing states. */
export type FrameEvent =
  | { readonly type: "init" }
  | { readonly type: "step" }
  /** A badge touched a station (before its tap finished). */
  | { readonly type: "touch"; readonly seat: DuelSeat }
  /** A tap finished and the rules took it. */
  | { readonly type: "tap"; readonly seat: DuelSeat }
  | { readonly type: "over" };

/** A badge's tap as a bundle's page hears it. */
export interface BundleTap {
  /** Whose tap: a place in the page's `players`. A seat left empty at the Box isn't one, so a place isn't always a `Seat`. */
  readonly seat: number;
  /** When the chip touched the reader: the Box's clock, ms since the epoch. */
  readonly at: number;
  /** The tap's verified roll, on a game whose manifest asks for `random` taps. */
  readonly roll: number | null;
}

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
  | { readonly t: "update"; readonly state: unknown; readonly event: FrameEvent; readonly now: number }
  /** A bundle's page, once its frame has loaded: the match's players in seat order, as the Box knows them by then. It answers `ready`. */
  | { readonly t: "bundle-init"; readonly players: readonly BundlePlayer[] }
  | ({ readonly t: "tap" } & BundleTap);

/** An error's message is at most MAX_MESSAGE characters (runner.ts). */
export type FromFrame = { readonly t: "ready" } | { readonly t: "error"; readonly message: string };

/** All a bundle's page may say. A built game's frame stays on `FromFrame`: it only draws. */
export type FromBundle =
  | FromFrame
  /** For the log: `name` is at most LOG_LIMITS.eventName printable characters, `data` at most LOG_LIMITS.eventDataBytes of JSON. */
  | { readonly t: "event"; readonly name: string; readonly data: unknown }
  /** A line for a seat's station, cut to what a station's line holds. */
  | { readonly t: "station"; readonly seat: number; readonly text: string }
  | { readonly t: "buzz"; readonly seat: number }
  /** The game says it's over. That only closes the match: a game has no say over money. */
  | { readonly t: "end" };

/** What a bundle's page gets as `window.egb`. */
export interface BundleApi {
  /** The match's players in seat order, there from the page's first line. */
  readonly players: readonly BundlePlayer[];
  onTap(listener: (tap: BundleTap) => void): void;
  event(name: string, data?: unknown): void;
  station(seat: number, text: string): void;
  buzz(seat: number): void;
  end(): void;
}

/**
 * How much a bundle's page may say, held by the kiosk's gate. Rates are per second and a burst is the most that can
 * land at once; stations and buzzes count per seat. Game events get half the log, so a flood can't crowd out the Box's
 * own taps.
 */
export const FRAME_LIMITS = {
  eventRate: 20,
  eventBurst: 40,
  stationRate: 4,
  stationBurst: 4,
  buzzRate: 2,
  buzzBurst: 2,
  eventEntries: LOG_LIMITS.entries / 2,
  eventBytes: LOG_LIMITS.logBytes / 2,
  /** The most one message may weigh, a character or a part being one each: four times an event's data, so no honest message nears it. */
  messageWeight: 4 * LOG_LIMITS.eventDataBytes,
  /** How many messages past that weight, or that aren't plain JSON, lose the page. */
  oversized: 3,
} as const;
