// The kiosk's view of a store match: the bundle's page in <iframe sandbox="allow-scripts">, behind the kiosk's gate. Once
// the frame has loaded the view sends `bundle-init`, the page answers `ready`, and each tap follows. What the gate lets
// through goes on to the Box through `powers`, and the Box writes the log.
//
// The view speaks first because a `ready` can't be believed by itself: a page can say it by hand before it has loaded
// and then leave, and the kiosk would see the same `ready` and `load` as from a page that stayed. Only an answer to
// something sent after the load proves the page that loaded is listening. One said sooner is spent (the gate takes one),
// so a page can't vouch for whatever lands in the frame, and one that never loads is never asked.
//
// Unlike a built game, the page holds the game. A stray error gets the quiet plate and the taps still count, but a page
// that never loads, leaves its page or floods the gate is lost: the frame goes, and the Box hears it, so a broken game
// closes the match at once instead of running out the manifest's time.
import type { BundlePlayer, BundleTap, LogEntry } from "@egb/sdk";
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
  readonly players: readonly BundlePlayer[];
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
    let asked = false;
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
    const gate = createBundleGate(
      match.players.length,
      () => performance.now(),
      () => lost("the page kept sending more than it may say"),
    );

    const channel = openFrameChannel(window, frame, gate, {
      loaded() {
        asked = true;
        const { players } = source.match(ctx.link.state()) ?? match;
        channel.post({ t: "bundle-init", players });
      },
      message(message) {
        switch (message.t) {
          case "ready":
            if (!asked) return;
            ready = true;
            return clearTimeout(timeout);
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
