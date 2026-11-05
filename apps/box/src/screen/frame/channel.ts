// The kiosk's end of a built game's frame channel. The frame runs code nobody reviewed in
// <iframe sandbox="allow-scripts"> (no allow-same-origin), so:
//   - out: ToFrame messages, posted with targetOrigin "*": the frame's origin is opaque, so no origin could name it;
//     what goes out is only the game's own state and the seats' names.
//   - in: only from that frame's window, only from an opaque origin (a frame that somehow had its origin back is not
//     the frame this view made), and only `ready` or `error` with a short message. Everything else is dropped.
import type { FromFrame, ToFrame } from "@egb/sdk";

const MAX_MESSAGE = 300;

/**
 * The attributes the frame's <iframe> gets, in the order to set them: the sandbox first (scripts only, no same-origin),
 * then no features, no referrer, and the src last.
 */
export function frameAttributes(id: string, title: string): Readonly<Record<string, string>> {
  return {
    sandbox: "allow-scripts",
    allow: "",
    referrerpolicy: "no-referrer",
    title,
    src: `/games/${encodeURIComponent(id)}/frame.html`,
  };
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

export interface FrameChannel {
  post(message: ToFrame): void;
  dispose(): void;
}

/** Opens the channel to `frame`, listening on `host` (the kiosk's window). */
export function openFrameChannel(host: MessageHost, frame: Pick<HTMLIFrameElement, "contentWindow">, onMessage: (message: FromFrame) => void): FrameChannel {
  const listener = (event: Incoming) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow || event.origin !== "null") return;
    const message = parseFromFrame(event.data);
    if (message) onMessage(message);
  };
  host.addEventListener("message", listener);
  return {
    post: (message) => frame.contentWindow?.postMessage(message, "*"),
    dispose: () => host.removeEventListener("message", listener),
  };
}
