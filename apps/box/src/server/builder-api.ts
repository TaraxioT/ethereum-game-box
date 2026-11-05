// The game builder's routes, under /api/builder (paths and replies in builder-wire.ts). Every one is a `launcher`
// route: only the kiosk's own page, holding this boot's token, may call them (they start paid model sessions and
// install code); the handler checks the token, and a local origin for every write. A Designer refusal is its own
// status with its code in a header; a Forge refusal is a 409. Nothing here waits on a build: builds run in the Forge's
// child processes, and their progress reaches the screen over the event stream.
import type http from "node:http";
import { DesignerError } from "../builder/designer/errors.ts";
import { ForgeRequestError } from "../builder/forge/service.ts";
import type { Builder } from "./builder-host.ts";
import type { BuilderFrame } from "./builder-stream.ts";
import {
  BUILDER,
  DESIGNER_CODE_HEADER,
  type CancelReply,
  type ConfirmReply,
  type JobReply,
  type TranscribeReply,
} from "./builder-wire.ts";
import { HttpError, readBody, readJson, sendFile, sendJson, sendText } from "./http.ts";
import type { Route } from "./routes.ts";

/** A recorded answer: a push-to-talk of at most ~30 s of opus is well under this. */
export const AUDIO_LIMIT = 2 * 1024 * 1024;
/** Typed answers past this are refused outright (the Designer reads only its first 500 characters anyway). */
const MAX_TEXT = 2_000;
/** Ids, keys, game ids and mime types are short. */
const MAX_ID = 128;

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void> | void;

/** Refusals in their own words: a Designer refusal's status and code, a Forge refusal as a conflict. */
function guarded(handle: Handler): Handler {
  return async (req, res, url) => {
    try {
      await handle(req, res, url);
    } catch (error) {
      if (error instanceof DesignerError) {
        res.setHeader(DESIGNER_CODE_HEADER, error.code);
        return sendText(res, error.status, error.message);
      }
      if (error instanceof ForgeRequestError) return sendText(res, 409, error.message);
      throw error;
    }
  };
}

const route = (method: Route["method"], path: string, handle: Handler): Route => ({ method, path, launcher: true, handle: guarded(handle) });

/** A JSON object body (an empty body is `{}`). */
async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const empty = req.headers["content-length"] === "0" || (req.headers["content-length"] === undefined && req.headers["transfer-encoding"] === undefined);
  const value = empty ? {} : await readJson(req);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "the body must be a JSON object");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = MAX_ID): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new HttpError(400, `${name} must be a string of 1 to ${max} characters`);
  return value;
}

/** The optional `session` a screen sends so it never edits a newer design than the one it shows. */
function session(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value, "session");
}

export function builderRoutes(builder: Builder): Route[] {
  const { designer, forge } = builder;
  const noContent = (res: http.ServerResponse): void => void res.writeHead(204).end();

  return [
    route("GET", BUILDER.status, (_req, res) => sendJson(res, builder.status())),

    route("GET", BUILDER.designer, (_req, res) => sendJson(res, designer.state())),
    route("POST", BUILDER.start, async (req, res) => {
      await body(req);
      sendJson(res, designer.start());
    }),
    route("POST", BUILDER.choose, async (req, res) => {
      const b = await body(req);
      sendJson(res, designer.choose(text(b.choice, "choice"), session(b.session)));
    }),
    route("POST", BUILDER.answer, async (req, res) => {
      const b = await body(req);
      if (typeof b.text !== "string" || b.text.length > MAX_TEXT) throw new HttpError(400, `text must be a string of at most ${MAX_TEXT} characters`);
      sendJson(res, await designer.answer(b.text, session(b.session)));
    }),
    route("POST", BUILDER.back, async (req, res) => {
      const b = await body(req);
      sendJson(res, designer.back(session(b.session)));
    }),
    route("POST", BUILDER.confirm, async (req, res) => {
      const b = await body(req);
      const brief = designer.confirm(session(b.session));
      const job = builder.lastConfirmed();
      if (!job) throw new HttpError(500, "the build didn't start");
      sendJson(res, { brief, job } satisfies ConfirmReply);
    }),

    route("POST", BUILDER.transcribe, async (req, res, url) => {
      const mime = String(req.headers["content-type"] ?? "application/octet-stream").slice(0, MAX_ID);
      const audio = await readBody(req, AUDIO_LIMIT);
      const reply = await designer.transcribe(new Uint8Array(audio), mime, session(url.searchParams.get("session") ?? undefined));
      sendJson(res, reply satisfies TranscribeReply);
    }),
    route("POST", BUILDER.speak, async (req, res) => {
      const b = await body(req);
      sendJson(res, await designer.speak(session(b.session)));
    }),
    route("GET", BUILDER.clip, async (_req, res, url) => {
      // Only a clip the voice made: clipPath() knows its own names, and nothing else maps to a file.
      const file = designer.clipPath(text(url.searchParams.get("file"), "file"));
      if (!file || !(await sendFile(res, file, { "cache-control": "private, max-age=31536000, immutable" }))) sendText(res, 404, "no such clip");
    }),
    route("GET", BUILDER.turns, (_req, res) => sendJson(res, designer.mockTurns())),

    route("GET", BUILDER.jobs, (_req, res) => sendJson(res, forge.list())),
    route("GET", BUILDER.job, (_req, res, url) => {
      const id = text(url.searchParams.get("id"), "id");
      const job = forge.get(id);
      if (!job) return sendText(res, 404, "no such build");
      sendJson(res, { job, events: forge.events(id) } satisfies JobReply);
    }),
    route("POST", BUILDER.cancel, async (req, res) => {
      const id = text((await body(req)).id, "id");
      if (!forge.get(id)) return sendText(res, 404, "no such build");
      sendJson(res, { cancelled: forge.cancel(id) } satisfies CancelReply);
    }),
    route("POST", BUILDER.remove, async (req, res) => {
      forge.remove(text((await body(req)).game, "game"));
      noContent(res);
    }),

    route("GET", BUILDER.events, (req, res, url) => {
      // A late screen first gets where things stand and the build so far, then everything live, in one stream.
      const asked = url.searchParams.get("job");
      const job = asked === null ? builder.activeJob() : forge.get(text(asked, "job"));
      if (asked !== null && !job) return sendText(res, 404, "no such build");
      const first: BuilderFrame[] = [
        { event: "hello", data: { designer: designer.state(), job, status: builder.status() } },
        ...(job ? forge.events(job.id) : []).map((event): BuilderFrame => ({ event: "forge", data: event })),
      ];
      builder.stream.attach(req, res, first);
    }),
  ];
}
