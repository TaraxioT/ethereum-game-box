// The kiosk's view of a store match: the bundle's page in <iframe sandbox="allow-scripts">, behind the kiosk's gate. The
// page says `ready` once it has loaded; the view sends `bundle-init`, then each tap. What the gate lets through goes on
// to the Box through `powers`, and the Box writes the log.
//
// Unlike a built game, the page holds the game. A stray error gets the quiet plate and the taps still count, but a page
// that never loads or leaves its page is lost: the frame goes, and the Box hears it, so a broken game closes the match
// at once instead of running out the manifest's time.
import type { BundleTap, FrameSeat, LogEntry } from "@egb/sdk";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import type { View, ViewContext, ViewFactory } from "../views/view.ts";
import { createBundleGate } from "./bundle-gate.ts";
import { bundleFrameAttributes, openFrameChannel } from "./channel.ts";
import { frameGlass, READY_TIMEOUT_MS } from "./view.ts";

/** A store match as its frame sees it. */
export interface BundleMatch {
  /** The bundle's sha256, as `0x` hex. */
  readonly hash: string;
  readonly title: string;
  /** The match's players, in seat order. */
  readonly players: readonly FrameSeat[];
}

export interface BundleSource {
  /** The store match in the Box's state, or null while none plays. */
  match(state: BoxState): BundleMatch | null;
  /** The tap a BoxEvent brings the game, or null for any other moment. */
  tap(event: BoxEvent): BundleTap | null;
}

/** Why the kiosk closes a match. The Box closes it itself when the manifest's time runs out. */
export type BundleEnd = Exclude<Extract<LogEntry, { t: "end" }>["why"], "time">;

/** Where a page's words go once the gate has passed them. */
export interface BundlePowers {
  event(name: string, data: unknown): void;
  station(seat: number, text: string): void;
  buzz(seat: number): void;
  /** Called at most once. */
  end(why: BundleEnd): void;
}

export function bundleFrameView(source: BundleSource, powers: (ctx: ViewContext) => BundlePowers): ViewFactory {
  return (ctx): View => {
    const match = source.match(ctx.link.state());
    const { root, frame, showFault } = frameGlass(ctx.layout, match ? bundleFrameAttributes(match.hash, match.title, match.players) : {});
    if (!match) return { el: root, update: () => {} };

    const out = powers(ctx);
    let ready = false;
    let ended = false;
    const end = (why: BundleEnd) => {
      clearTimeout(timeout);
      if (!ended) out.end(why);
      ended = true;
    };
    const lost = (why: string) => {
      channel.dispose();
      frame.remove();
      showFault(why);
      end("lost");
    };
    const timeout = setTimeout(() => lost("the page never said ready"), READY_TIMEOUT_MS);

    const channel = openFrameChannel(window, frame, createBundleGate(match.players.length, () => performance.now()), {
      message(message) {
        switch (message.t) {
          case "ready": {
            ready = true;
            clearTimeout(timeout);
            const { players } = source.match(ctx.link.state()) ?? match;
            return channel.post({ t: "bundle-init", players, now: ctx.link.now(), calm: ctx.calm });
          }
          case "error":
            return showFault(message.message);
          case "event":
            return out.event(message.name, message.data);
          case "station":
            return out.station(message.seat, message.text);
          case "buzz":
            return out.buzz(message.seat);
          case "end":
            return end("game");
        }
      },
      left: () => lost("the page left"),
    });

    return {
      el: root,
      update(_state: BoxState, event: BoxEvent) {
        const tap = ready ? source.tap(event) : null;
        if (tap) channel.post({ t: "tap", ...tap });
      },
      dispose() {
        clearTimeout(timeout);
        channel.dispose();
        frame.remove();
      },
    };
  };
}
