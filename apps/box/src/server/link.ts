// The screen's link: a WebSocket on the HTTP server's own port, at LINK_PATH. A screen gets the whole state on
// connect, then every event with the state after it, in order and never coalesced; changes with no event (the
// stations moving with the clock) go out as whole states at most every LINK_COALESCE_MS. Every message carries the
// Box's clock. Commands from a screen go to the core.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { LOG_LIMITS, PLAYER_LIMITS, SMALL_CHARS, printable, utf8Bytes } from "@egb/sdk";
import { WebSocketServer, type WebSocket } from "ws";
import type { BoxEvent, BoxLink, BoxState, FrameWord, ScreenCommand } from "../core/types.ts";
import { LINK_COALESCE_MS, LINK_PATH, STATE_ONLY, type LinkDown } from "../core/wire.ts";
import { coalesce } from "./coalesce.ts";
import { loopbackHost, sameOrigin } from "./http.ts";

/** A screen that leaves this much unread is dropped; a live page reconnects and starts from a whole state. */
const MAX_BUFFERED = 1024 * 1024;
/** Each socket is pinged this often, and dropped if it didn't answer the last ping. */
const PING_MS = 15_000;
/** The screen sends only small commands: the largest is a store game's event, at most a KB of data. */
const MAX_COMMAND = 4 * 1024;
/** A game event's name, as the kiosk's gate lets it through. */
const EVENT_NAME = new RegExp(`^[\\x20-\\x7e]{1,${LOG_LIMITS.eventName}}$`);

export interface ScreenLink {
  /** Screens connected now. */
  clients(): number;
  close(): void;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSeatNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < PLAYER_LIMITS.max;
}

/** A store game's word as the log can take it, or null. The kiosk's gate holds the same line, and the rates. */
function parseFrameWord(value: unknown): FrameWord | null {
  if (typeof value !== "object" || value === null) return null;
  const word = value as Record<string, unknown>;
  switch (word.t) {
    case "end":
      return word.why === "game" || word.why === "lost" ? { t: "end", why: word.why } : null;
    case "buzz":
      return isSeatNumber(word.seat) ? { t: "buzz", seat: word.seat } : null;
    case "station":
      return isSeatNumber(word.seat) && typeof word.text === "string" ? { t: "station", seat: word.seat, text: printable(word.text, SMALL_CHARS) } : null;
    case "event": {
      if (typeof word.name !== "string" || !EVENT_NAME.test(word.name) || word.data === undefined) return null;
      return utf8Bytes(JSON.stringify(word.data)) <= LOG_LIMITS.eventDataBytes ? { t: "event", name: word.name, data: word.data } : null;
    }
    default:
      return null;
  }
}

/** A screen command from a message, or null when it isn't one. */
export function parseCommand(data: string): ScreenCommand | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null || (message as { t?: unknown }).t !== "command") return null;
  const command = (message as { command?: unknown }).command;
  if (typeof command !== "object" || command === null) return null;
  const c = command as Record<string, unknown>;
  switch (c.type) {
    case "booted":
    case "start":
    case "play":
    case "back":
    case "rematch":
    case "home":
    case "refund":
    case "build":
    case "lobby":
    case "topup":
    case "propose":
    case "claim":
      return { type: c.type };
    case "focus":
      return typeof c.game === "string" && c.game.length <= 64 ? { type: "focus", game: c.game } : null;
    case "stake":
      return isNumber(c.amount) ? { type: "stake", amount: c.amount } : null;
    case "play-for":
      return c.target === "title" || c.target === "cup" ? { type: "play-for", target: c.target } : null;
    case "frame": {
      const word = parseFrameWord(c.word);
      return word ? { type: "frame", word } : null;
    }
    default:
      return null;
  }
}

export function attachLink(server: http.Server, box: BoxLink, log: (text: string) => void): ScreenLink {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_COMMAND });
  const alive = new WeakMap<WebSocket, boolean>();

  function frame(message: LinkDown): string {
    return JSON.stringify(message);
  }

  function send(socket: WebSocket, text: string): void {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED) {
      socket.terminate();
      return;
    }
    socket.send(text);
  }

  function broadcast(text: string): void {
    for (const socket of wss.clients) send(socket, text);
  }

  const states = coalesce(() => broadcast(frame({ t: "state", now: box.now(), state: box.state() })), LINK_COALESCE_MS);

  const unsubscribe = box.subscribe((state: BoxState, event: BoxEvent) => {
    if (wss.clients.size === 0) return;
    if (event.type === STATE_ONLY.type) return states.trigger();
    // An event carries the whole state, so a state still waiting to go out is already in it.
    states.cancel();
    broadcast(frame({ t: "event", now: box.now(), state, event }));
  });

  function onUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(req.url ?? "/", "http://box").pathname;
    const refuse = (status: string): void => {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    if (path !== LINK_PATH) return refuse("404 Not Found");
    if (!loopbackHost(req.headers.host)) return refuse("421 Misdirected Request");
    if (!sameOrigin(req.headers.origin, req.headers.host)) return refuse("403 Forbidden");
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  }
  server.on("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("error", (error) => log(`link: ${error.message}`));
    ws.on("message", (data, binary) => {
      const command = binary ? null : parseCommand(data.toString());
      if (command) box.send(command);
    });
    // A newcomer starts from the whole state, then hears every event after it.
    send(ws, frame({ t: "state", now: box.now(), state: box.state() }));
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_MS);
  ping.unref();

  return {
    clients: () => wss.clients.size,
    close() {
      clearInterval(ping);
      states.cancel();
      unsubscribe();
      server.off("upgrade", onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
