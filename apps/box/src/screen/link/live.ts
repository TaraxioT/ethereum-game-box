// LiveLink: BoxLink over the WebSocket to the Box server (the box build). The server sends the whole state on
// connect, then each event with the state after it; the screen's commands go back up. Every message carries the
// server's clock, and `now()` reads the Box's clock through the link's offset, so views time their animations on the
// server's clock. A dropped socket reconnects with backoff and starts again from the whole state.
import type { BoxEvent, BoxLink, BoxState, ScreenCommand } from "../../core/types.ts";
import type { LinkDown, LinkUp } from "../../core/wire.ts";
import { STATE_ONLY } from "../../core/wire.ts";
import { createClockOffset } from "./offset.ts";
import { reuse } from "./reuse.ts";

/** Reconnect waits: from the first, doubling up to the last. */
export const RECONNECT_FIRST_MS = 250;
export const RECONNECT_MAX_MS = 4_000;

/** The part of the WebSocket API the link uses: the browser's, or Node's global one in tests. */
export interface LinkSocket {
  readonly readyState: number;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface LiveLinkOptions {
  /** The link's ws:// URL. */
  readonly url: string;
  readonly socket?: (url: string) => LinkSocket;
  /** The screen's own clock. */
  readonly localNow?: () => number;
}

export interface LiveLink extends BoxLink {
  /** A socket is open and has had its first state. */
  connected(): boolean;
  /** Closes the socket for good. */
  close(): void;
}

const OPEN = 1;

/** Connects, and resolves with the link once the first whole state has arrived. */
export function connectLive(options: LiveLinkOptions): Promise<LiveLink> {
  const open = options.socket ?? ((url: string) => new WebSocket(url) as unknown as LinkSocket);
  const localNow = options.localNow ?? (() => Date.now());
  const offset = createClockOffset();
  const listeners = new Set<(state: BoxState, event: BoxEvent) => void>();
  let state: BoxState | null = null;
  let socket: LinkSocket | null = null;
  /** This socket has had its first state. */
  let live = false;
  let closed = false;
  let wait = RECONNECT_FIRST_MS;
  let retry: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolve) => {
    const link: LiveLink = {
      state() {
        if (!state) throw new Error("the link has no state yet");
        return state;
      },
      now: () => localNow() + offset.value(),
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      send(command: ScreenCommand) {
        // A touch while the link is down goes nowhere: the screen redraws from the Box's state when it is back.
        if (socket?.readyState !== OPEN || !live) return;
        socket.send(JSON.stringify({ t: "command", command } satisfies LinkUp));
      },
      connected: () => live,
      close() {
        closed = true;
        clearTimeout(retry);
        socket?.close();
      },
    };

    function deliver(next: BoxState, event: BoxEvent): void {
      state = state ? reuse(state, next) : next;
      for (const listener of [...listeners]) listener(state, event);
    }

    function receive(message: LinkDown): void {
      offset.sample(message.now, localNow());
      if (message.t === "event") return deliver(message.state, message.event);
      const first = !live;
      live = true;
      wait = RECONNECT_FIRST_MS;
      if (!state) {
        state = message.state;
        resolve(link);
        return;
      }
      // The whole state again: after a reconnect the screen starts over from it; otherwise it is the stations moving.
      deliver(message.state, first ? { type: "init" } : STATE_ONLY);
    }

    function connect(): void {
      const ws = open(options.url);
      socket = ws;
      live = false;
      offset.reset();
      ws.onmessage = (event) => {
        if (socket !== ws || typeof event.data !== "string") return;
        let message: LinkDown;
        try {
          message = JSON.parse(event.data) as LinkDown;
        } catch {
          return;
        }
        receive(message);
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        live = false;
        if (closed) return;
        retry = setTimeout(connect, wait);
        wait = Math.min(wait * 2, RECONNECT_MAX_MS);
      };
      // An error is always followed by a close, which reconnects.
      ws.onerror = () => {};
    }

    connect();
  });
}
