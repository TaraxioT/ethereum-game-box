// The kiosk's end of a game's frame channel. The frame runs code nobody reviewed in
// <iframe sandbox="allow-scripts"> (no allow-same-origin), so:
//   - out: ToFrame messages, posted with targetOrigin "*": the frame's origin is opaque, so no origin could name it;
//     what goes out is only the game's own state, the seats' names and, to a store bundle's page, each tap.
//   - in: only from that frame's window, only from an opaque origin (a frame that somehow had its origin back is not
//     the frame this view made), and only what the channel's `read` takes: `ready` or `error` with a short message from
//     a built game (parseFromFrame), a little more from a store bundle (bundle-gate.ts). Everything else is dropped.
//   - only while the frame shows its own page. allow-scripts lets a frame navigate itself (`location = …`); the
//     kiosk's CSP (frame-src 'self') keeps it on the Box's own pages, but any page it lands on isn't the game's frame
//     and is out from under the frame's CSP (connect-src 'none'). The iframe's first `load` is its page (its src is
//     set before it is inserted, so no about:blank load comes first); a second means it left, and the channel closes
//     for good: nothing more goes out, nothing more comes in.
import { MAX_MESSAGE, type FrameSeat, type FromFrame, type ToFrame } from "@egb/sdk";

/** Scripts only, no same-origin, no features, no referrer. Set in this order, ahead of the src. */
const SANDBOX = { sandbox: "allow-scripts", allow: "", referrerpolicy: "no-referrer" } as const;

/** The attributes a built game's <iframe> gets, in the order to set them: the sandbox first and the src last. */
export function frameAttributes(id: string, title: string): Readonly<Record<string, string>> {
  return { ...SANDBOX, title, src: `/games/${encodeURIComponent(id)}/frame.html` };
}

/**
 * The same for a store bundle's page. The frame's name carries the players: a page's first script runs long before a
 * message could reach it, and the name is the one thing the kiosk can hand it sooner.
 */
export function bundleFrameAttributes(hash: string, title: string, players: readonly FrameSeat[]): Readonly<Record<string, string>> {
  return { ...SANDBOX, title, name: JSON.stringify(players), src: `/store/${encodeURIComponent(hash)}/index.html` };
}

/** A FromFrame, or null for anything else. */
export function parseFromFrame(data: unknown): FromFrame | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.t === "ready" && Object.keys(m).length === 1) return { t: "ready" };
  if (m.t === "error" && typeof m.message === "string" && Object.keys(m).length === 2) return { t: "error", message: m.message.slice(0, MAX_MESSAGE) };
  return null;
}

/** What the channel reads off a `message` event. */
export type Incoming = Pick<MessageEvent, "data" | "source" | "origin">;

export interface MessageHost {
  addEventListener(type: "message", listener: (event: Incoming) => void): void;
  removeEventListener(type: "message", listener: (event: Incoming) => void): void;
}

/** The iframe as the channel uses it: its window, and its `load` events. */
export interface FrameElement {
  readonly contentWindow: Pick<Window, "postMessage"> | null;
  addEventListener(type: "load", listener: () => void): void;
  removeEventListener(type: "load", listener: () => void): void;
}

export interface FrameChannelEvents<M> {
  message(message: M): void;
  /** The frame's first `load`: its page has loaded, or the page it left for has. */
  loaded?(): void;
  /** The frame navigated away from its page: the channel has closed. */
  left(): void;
}

export interface FrameChannel {
  post(message: ToFrame): void;
  dispose(): void;
}

/** Opens the channel to `frame`, listening on `host` (the kiosk's window). `read` decides what the frame may say. */
export function openFrameChannel<M>(host: MessageHost, frame: FrameElement, read: (data: unknown) => M | null, events: FrameChannelEvents<M>): FrameChannel {
  let closed = false;
  let loads = 0;
  const listener = (event: Incoming) => {
    if (closed || !frame.contentWindow || event.source !== frame.contentWindow || event.origin !== "null") return;
    const message = read(event.data);
    if (message) events.message(message);
  };
  const onLoad = () => {
    loads++;
    if (closed) return;
    if (loads === 1) return events.loaded?.();
    dispose();
    events.left();
  };
  function dispose(): void {
    closed = true;
    host.removeEventListener("message", listener);
    frame.removeEventListener("load", onLoad);
  }
  host.addEventListener("message", listener);
  frame.addEventListener("load", onLoad);
  return {
    post: (message) => {
      if (!closed) frame.contentWindow?.postMessage(message, "*");
    },
    dispose,
  };
}
