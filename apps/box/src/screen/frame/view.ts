// The kiosk's view of a built game's match: the game's own screen in <iframe sandbox="allow-scripts">, fed through the
// frame channel. The frame says `ready` once its screen.js has loaded; the view then sends `init` with the state as it
// is by then (nothing before ready can be lost: init carries the whole state), and an `update` for each moment after.
//
// The frame only draws: the rules run on the server and the stations show the game, so a screen that fails or never
// loads doesn't stop the match. The view puts a quiet plate over it and the players play on.
import "./frame.css";
import type { BoxEvent, BoxState } from "../../core/types.ts";
import type { Orientation, Rect } from "../shell/layout.ts";
import type { View, ViewFactory } from "../views/view.ts";
import { el, place } from "../shell/dom.ts";
import { frameAttributes, openFrameChannel } from "./channel.ts";
import { frameInit, frameUpdate, type FrameMatch, type FrameSource } from "./feed.ts";

/** The Box's overlay (ports, clock, stake) holds the top of the stage; the game's frame owns everything below it. */
const OVERLAY: Record<Orientation, number> = { landscape: 130, portrait: 150 };

/** A screen that hasn't said ready by now isn't coming (the Pi loads a frame in well under a second). */
export const READY_TIMEOUT_MS = 8_000;

export function frameView(source: FrameSource): ViewFactory {
  return (ctx): View => {
    const root = el("div", "frame-view");
    const { orientation, width, height } = ctx.layout;
    const area: Rect = { x: 0, y: OVERLAY[orientation], w: width, h: height - OVERLAY[orientation] };
    place(root, area);

    let ready = false;
    let fault: HTMLElement | null = null;
    const showFault = (why: string) => {
      console.warn(`frame: ${why}`);
      if (fault) return;
      fault = el("egb-plate", "frame-fault", "SCREEN FAULT · PLAY ON");
      fault.setAttribute("variant", "metal");
      root.append(fault);
    };

    let match: FrameMatch | null = source(ctx.link.state());
    const frame = el("iframe", "frame-glass");
    // The sandbox goes on before the src, so the page never loads unsandboxed.
    if (match) for (const [name, value] of Object.entries(frameAttributes(match.id, match.manifest.title))) frame.setAttribute(name, value);
    root.append(frame);
    const timeout = setTimeout(() => ready || showFault("the screen never said ready"), READY_TIMEOUT_MS);

    const channel = openFrameChannel(window, frame, {
      message(message) {
        if (message.t === "error") return showFault(message.message);
        ready = true;
        clearTimeout(timeout);
        const state = ctx.link.state();
        match = source(state);
        if (match) channel.post(frameInit(match, state, ctx.link.now(), ctx.calm));
      },
      // The game's screen navigated away: whatever page it is on now is no game's frame. It goes, and the plate shows.
      left() {
        clearTimeout(timeout);
        frame.remove();
        showFault("the screen left its page");
      },
    });

    return {
      el: root,
      update(state: BoxState, event: BoxEvent) {
        const next = source(state);
        if (!next) return;
        const message = ready ? frameUpdate(match, next, event, ctx.link.now()) : null;
        match = next;
        if (message) channel.post(message);
      },
      dispose() {
        clearTimeout(timeout);
        channel.dispose();
        frame.remove();
      },
    };
  };
}
