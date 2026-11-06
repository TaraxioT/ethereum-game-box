// Server-Sent Events for the builder's screens: named events (`event: forge`, `data: {…}`) to every attached client.
// A client gets its first events at once (where things stand, a build's replay), written in the same tick it joins,
// so nothing published around its arrival is lost or doubled. A comment every 15 s keeps an idle connection open
// through anything that would time it out; a client that stops reading is dropped (it reconnects and starts over).
import type http from "node:http";
import type { BuilderEventName, BuilderEvents } from "./builder-wire.ts";

/** How often an idle stream gets a comment. */
const PING_MS = 15_000;
/** Bytes a client may leave unread before it is dropped: a frozen page would otherwise buffer every event forever. */
const MAX_BUFFERED = 1024 * 1024;

export interface BuilderFrame<K extends BuilderEventName = BuilderEventName> {
  readonly event: K;
  readonly data: BuilderEvents[K];
}

export interface BuilderStream {
  /** Takes over the response: the stream's headers, `first` in order, then every event sent from now on. */
  attach(req: http.IncomingMessage, res: http.ServerResponse, first: readonly BuilderFrame[]): void;
  send<K extends BuilderEventName>(event: K, data: BuilderEvents[K]): void;
  /** Clients attached now. */
  size(): number;
  /** Ends every stream. */
  close(): void;
}

const frame = (f: BuilderFrame): string => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;

export function createBuilderStream(): BuilderStream {
  const clients = new Set<http.ServerResponse>();
  const ping = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n");
  }, PING_MS);
  ping.unref();

  return {
    attach(req, res, first) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      });
      res.write(first.map(frame).join("") || ": hello\n\n");
      clients.add(res);
      const drop = () => clients.delete(res);
      req.on("close", drop);
      res.on("close", drop);
    },

    send(event, data) {
      if (clients.size === 0) return;
      const text = frame({ event, data } as BuilderFrame);
      for (const res of clients) {
        if (res.writableLength > MAX_BUFFERED) {
          clients.delete(res);
          res.destroy();
        } else res.write(text);
      }
    },

    size: () => clients.size,

    close() {
      clearInterval(ping);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
