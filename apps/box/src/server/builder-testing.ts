// For the builder's route tests: a Box whose shelf is the Forge's test template, requests that carry the launcher
// token from this machine's page, and the event stream read as the screen reads it.
import { fileURLToPath } from "node:url";
import type { Box } from "./box.ts";
import { LAUNCHER_HEADER } from "./security.ts";
import { startTestBox, type TestBox } from "./testing.ts";
import type { BuilderEventName, BuilderEvents } from "./builder-wire.ts";

/** The Forge's fixtures: its template `tap-three` builds and installs a real game from the sim's recording. */
export const FIXTURE_GAMES = fileURLToPath(new URL("../builder/forge/fixtures", import.meta.url));

export const ORIGIN = "http://127.0.0.1:8790";

export function startBuilderBox(): Promise<TestBox> {
  return startTestBox({ builder: { gameRoots: [FIXTURE_GAMES] } });
}

/** A request as the kiosk's page makes it: the token, and its origin on a write. */
export function call(box: Box, method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const json = body !== undefined && !(body instanceof Uint8Array);
  return fetch(`${box.url}${path}`, {
    method,
    headers: {
      [LAUNCHER_HEADER]: box.token,
      ...(method === "POST" ? { origin: ORIGIN } : {}),
      ...(json ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: json ? JSON.stringify(body) : (body as Uint8Array<ArrayBuffer>) }),
  });
}

export async function callJson<T>(box: Box, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await call(box, method, path, body);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface StreamEvent<K extends BuilderEventName = BuilderEventName> {
  readonly event: K;
  readonly data: BuilderEvents[K];
}

export interface TestStream {
  readonly events: StreamEvent[];
  /** Resolves with the first event from index `from` that passes `check`. */
  next<K extends BuilderEventName>(event: K, check?: (data: BuilderEvents[K]) => boolean, from?: number, ms?: number): Promise<BuilderEvents[K]>;
  close(): void;
}

/** The builder's event stream, parsed frame by frame. */
export async function openStream(box: Box, query = ""): Promise<TestStream> {
  const abort = new AbortController();
  const res = await fetch(`${box.url}/api/builder/events${query}`, { headers: { [LAUNCHER_HEADER]: box.token }, signal: abort.signal });
  if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
  const events: StreamEvent[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) events.push({ event: event as BuilderEventName, data: JSON.parse(data) as never });
        }
      }
    } catch {
      // Closed by the test.
    }
  })();
  return {
    events,
    async next(event, check = () => true, from = 0, ms = 60_000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = events.slice(from).find((e) => e.event === event && check(e.data as never));
        if (hit) return hit.data as never;
        if (Date.now() > deadline) throw new Error(`no ${event} event in ${ms} ms (got ${events.map((e) => e.event).join(", ")})`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    close: () => abort.abort(),
  };
}
