// The room behind the game, drawn once: a dark room lit faintly from above, each player's colour pooling up from
// their side, and a raised tray down the middle that holds the stat wheel and the played cards. A player's glow
// brightens on their moments (a play, a won round) by fading in a brighter copy of it: opacity only.
import type { Point, Rect } from "../../screen/shell/layout.ts";
import type { Seat } from "@egb/sdk";
import { el, place, play } from "../../screen/shell/dom.ts";

export interface ScenePlaces {
  readonly width: number;
  readonly height: number;
  /** The raised tray in the middle: the wheel and the played cards stand on it. */
  readonly tray: Rect;
  /** Where each player's colour pools from, and how far it reaches. */
  readonly glows: readonly [Point, Point];
  readonly reach: { readonly rx: number; readonly ry: number };
}

export interface Scene {
  readonly el: HTMLElement;
  /** The seat's glow flares up and settles back; `holdMs` is how long it stays bright. */
  flare(seat: Seat, holdMs: number): void;
  /** Keeps one glow bright (the match's winner), or none. */
  hold(seat: Seat | null): void;
}

export function createScene(at: ScenePlaces): Scene {
  const root = el("div", "sd-scene");
  place(root, { x: 0, y: 0, w: at.width, h: at.height });

  const glow = (seat: Seat, bright: boolean): HTMLElement => {
    const node = el("i", `sd-glow s${seat}${bright ? " bright" : ""}`);
    const c = at.glows[seat];
    place(node, { x: c.x - at.reach.rx, y: c.y - at.reach.ry, w: at.reach.rx * 2, h: at.reach.ry * 2 });
    return node;
  };
  const steady = [glow(0, false), glow(1, false)] as const;
  const bright = [glow(0, true), glow(1, true)] as const;
  const tray = el("i", "sd-tray");
  place(tray, at.tray);
  root.append(...steady, ...bright, tray);

  let held: Seat | null = null;

  return {
    el: root,
    flare(seat, holdMs) {
      if (held === seat) return;
      const total = 260 + holdMs + 900;
      void play(
        bright[seat],
        [{ opacity: 0 }, { opacity: 1, offset: 260 / total }, { opacity: 1, offset: (260 + holdMs) / total }, { opacity: 0 }],
        { duration: total, easing: "ease-out" },
      );
    },
    hold(seat) {
      held = seat;
      for (const s of [0, 1] as const) bright[s].classList.toggle("held", s === seat);
    },
  };
}
