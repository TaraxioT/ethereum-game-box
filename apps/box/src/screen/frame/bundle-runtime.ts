// The frame side of a store bundle's page: the `window.egb` that /bundle-host.js gives it. A convenience and no wall: a
// game can post what it likes by hand, and the kiosk's gate (bundle-gate.ts) decides everything.
//
// The kiosk sends `bundle-init` once the frame has loaded, so a game's own scripts have run and its tap listeners are on,
// and the page answers `ready` (bundle-view.ts says why it waits to be asked). `players` is there sooner than that, from
// the frame's name, so a game can read it on its first line; `bundle-init` then brings them up to date in the same array.
//
// Platform-free (no window, no parent): bundle-host.ts wires it to the page, and the tests drive it directly.
import type { BundleApi, BundleTap, FrameSeat, FromBundle, ToFrame } from "@egb/sdk";
import { errorText, MAX_ERRORS } from "./runtime.ts";

export interface BundleRuntimeOptions {
  /** Posts to the kiosk. */
  post(message: FromBundle): void;
  /** The frame's name: the players as JSON (channel.ts). */
  readonly name: string;
}

export interface BundleRuntime {
  readonly egb: BundleApi;
  /** A message from the kiosk: anything that isn't for a bundle's page is ignored. */
  receive(data: unknown): void;
  /** Reports an error from anywhere in the page (window `error`, unhandled rejections). */
  fail(error: unknown): void;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The players in the frame's name; none if it holds anything else. */
function playersIn(name: string): FrameSeat[] {
  try {
    const players = JSON.parse(name) as unknown;
    return Array.isArray(players) ? (players as FrameSeat[]) : [];
  } catch {
    return [];
  }
}

/** The kiosk's messages, by shape: the kiosk is trusted, but a stray message must never reach the game's code. */
function toBundle(data: unknown): Extract<ToFrame, { t: "bundle-init" | "tap" }> | null {
  if (!isObject(data)) return null;
  if (data.t === "bundle-init" && Array.isArray(data.players)) return data as unknown as Extract<ToFrame, { t: "bundle-init" }>;
  if (data.t === "tap" && typeof data.seat === "number" && typeof data.at === "number") return data as unknown as Extract<ToFrame, { t: "tap" }>;
  return null;
}

export function createBundleRuntime(options: BundleRuntimeOptions): BundleRuntime {
  const { post } = options;
  const players = playersIn(options.name);
  const listeners: ((tap: BundleTap) => void)[] = [];
  let errors = 0;

  function fail(error: unknown): void {
    if (errors >= MAX_ERRORS) return;
    errors++;
    post({ t: "error", message: errorText(error) });
  }

  return {
    egb: {
      players,
      onTap: (listener) => void listeners.push(listener),
      event: (name, data = null) => post({ t: "event", name, data }),
      station: (seat, text) => post({ t: "station", seat, text }),
      buzz: (seat) => post({ t: "buzz", seat }),
      end: () => post({ t: "end" }),
    },
    receive(data) {
      const message = toBundle(data);
      if (!message) return;
      if (message.t === "bundle-init") {
        players.splice(0, players.length, ...message.players);
        post({ t: "ready" });
        return;
      }
      const { seat, at, roll } = message;
      for (const listener of listeners) {
        try {
          listener({ seat, at, roll });
        } catch (error) {
          fail(error);
        }
      }
    },
    fail,
  };
}
