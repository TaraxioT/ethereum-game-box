// A store match as the kiosk plays it: what its frame hears from the Box's state and events, and where the page's words
// go once the gate has passed them. The view (bundle-view.ts) runs on these; the core writes the log. Pure.
import type { FrameWord } from "../../core/types.ts";
import type { ViewContext } from "../views/view.ts";
import type { BundlePowers, BundleSource } from "./bundle-view.ts";
import { framePlayers } from "./feed.ts";

/** The store game playing in the Box's state, and the finished taps the core hands it. */
export const storeMatch: BundleSource = {
  match(state) {
    const play = state.match?.play;
    return play?.game === "store" ? { hash: play.bundle, title: play.title, players: framePlayers(state) } : null;
  },
  tap: (event) => (event.type === "game-tap" ? { seat: event.seat, at: event.at, roll: event.roll } : null),
};

/** A page's words, as commands over the link. */
export function storePowers({ link }: ViewContext): BundlePowers {
  const say = (word: FrameWord): void => link.send({ type: "frame", word });
  return {
    event: (name, data) => say({ t: "event", name, data }),
    station: (seat, text) => say({ t: "station", seat, text }),
    buzz: (seat) => say({ t: "buzz", seat }),
    end: (why) => say({ t: "end", why }),
  };
}
