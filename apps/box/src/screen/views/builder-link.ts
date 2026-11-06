// The page's line to the game builder (server/builder-wire.ts has the routes). The Box writes this boot's launcher
// token into the page as a meta tag on a top-level navigation only; this module takes it at load, removes the tag,
// and keeps it here, sending it as a header on the builder's routes and nowhere else. The event stream is a fetch read
// frame by frame, because EventSource can't send a header; it reconnects by itself and starts over from `hello`.
import {
  DESIGNER_CODE_HEADER,
  LAUNCHER_HEADER,
  LAUNCHER_META,
  BUILDER,
} from "../../server/builder-wire.ts";
import { readFrames, type BuilderFrameListener } from "../../server/builder-frames.ts";

/** A refusal from the builder: the HTTP status, the Designer's code when it has one, and the Box's own words. */
export class BuilderError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function takeToken(): string | null {
  const tags = [...document.querySelectorAll<HTMLMetaElement>(`meta[name="${LAUNCHER_META}"]`)];
  for (const tag of tags) tag.remove();
  return tags[0]?.content.trim() || null;
}

const token = takeToken();

/** Whether this page got the token: only the kiosk's own page, opened as a page, has it. */
export const hasLauncherToken = (): boolean => token !== null;

const headers = (extra: Record<string, string> = {}): Record<string, string> => (token ? { [LAUNCHER_HEADER]: token, ...extra } : extra);

async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new BuilderError(0, null, "The Box isn't answering.");
  }
  if (!res.ok) throw new BuilderError(res.status, res.headers.get(DESIGNER_CODE_HEADER), (await res.text()) || `The Box said ${res.status}.`);
  return res;
}

const json = async <T>(res: Response): Promise<T> => (res.status === 204 ? (null as T) : ((await res.json()) as T));

export function getJson<T>(path: string): Promise<T> {
  return send(path, { headers: headers() }).then((res) => json<T>(res));
}

export function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  return send(path, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body) }).then((res) => json<T>(res));
}

/** Raw bytes up (a recorded answer, typed by its mime type); JSON back. */
export function postBytes<T>(path: string, bytes: Blob): Promise<T> {
  return send(path, { method: "POST", headers: headers({ "content-type": bytes.type || "application/octet-stream" }), body: bytes }).then((res) => json<T>(res));
}

/** A file's bytes (a spoken clip). */
export function getBytes(path: string): Promise<ArrayBuffer> {
  return send(path, { headers: headers() }).then((res) => res.arrayBuffer());
}

export interface BuilderStreamHandle {
  close(): void;
}

/** First retry after a dropped stream, doubling to the most. */
const RETRY_MS = 500;
const RETRY_MAX_MS = 4_000;

/**
 * The builder's event stream: `hello` first (and again after every reconnect), then `designer` and `forge` events.
 * `query` asks for a particular build's replay (`?job=…`).
 */
export function openBuilderStream(listener: BuilderFrameListener, query = ""): BuilderStreamHandle {
  let closed = false;
  let abort: AbortController | null = null;
  let retry = RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function run(): Promise<void> {
    abort = new AbortController();
    try {
      const res = await fetch(`${BUILDER.events}${query}`, { headers: headers(), cache: "no-store", signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      await readFrames(res.body, (event, data) => {
        // A stream that delivers is a healthy one: the next drop starts its backoff over.
        retry = RETRY_MS;
        listener(event, data);
      });
    } catch {
      // Dropped, refused or closed: try again unless closed.
    }
    if (closed) return;
    timer = setTimeout(() => void run(), retry);
    retry = Math.min(retry * 2, RETRY_MAX_MS);
  }

  void run();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      abort?.abort();
    },
  };
}
