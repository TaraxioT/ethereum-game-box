// The builder's routes over real HTTP: the launcher token on every one, a local origin on every write, the Designer's
// refusals as their status codes, the Forge's as conflicts, the cap on recorded audio, the event stream with its replay
// for a late screen, and /api/state busy while a build runs.
import { afterEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import type { DesignerState } from "../builder/types.ts";
import { AUDIO_LIMIT } from "./builder-api.ts";
import {
  BUILDER,
  DESIGNER_CODE_HEADER,
  type BuilderStatus,
  type ConfirmReply,
  type JobReply,
  type MockTurn,
  type TranscribeReply,
} from "./builder-wire.ts";
import { call, callJson, openStream, startBuilderBox, type TestStream } from "./builder-testing.ts";
import { LAUNCHER_HEADER } from "./security.ts";
import type { TestBox } from "./testing.ts";

let tb: TestBox | null = null;
const streams: TestStream[] = [];
afterEach(async () => {
  for (const s of streams.splice(0)) s.close();
  await tb?.stop();
  tb = null;
});

async function start(): Promise<TestBox> {
  tb = await startBuilderBox();
  return tb;
}

async function stream(t: TestBox, query = ""): Promise<TestStream> {
  const s = await openStream(t.box, query);
  streams.push(s);
  return s;
}


/**
 * The status of a POST whose headers announce a body of `length` bytes: the Box answers before reading any of it (a
 * fetch of the whole body would see the connection close under its upload instead).
 */
function announced(box: TestBox["box"], path: string, length: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${box.url}${path}`, {
      method: "POST",
      headers: { [LAUNCHER_HEADER]: box.token, origin: new URL(box.url).origin, "content-type": "audio/webm", "content-length": String(length) },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on("error", reject);
    req.flushHeaders();
  });
}

/** Keys from the first open question to the read-back. */
async function keysToConfirm(t: TestBox): Promise<DesignerState> {
  let state = await callJson<DesignerState>(t.box, "POST", BUILDER.start, {});
  while (state.step !== "confirm") state = await callJson<DesignerState>(t.box, "POST", BUILDER.choose, { choice: state.choices[0]!.id, session: state.session });
  return state;
}

describe("the builder's routes", () => {
  it("need this boot's launcher token, every one of them", async () => {
    const { box } = await start();
    const reads = [BUILDER.status, BUILDER.designer, BUILDER.clip, BUILDER.turns, BUILDER.jobs, BUILDER.job, BUILDER.events];
    const writes = [BUILDER.start, BUILDER.choose, BUILDER.answer, BUILDER.back, BUILDER.confirm, BUILDER.transcribe, BUILDER.speak, BUILDER.cancel, BUILDER.remove];
    expect(reads.length + writes.length).toBe(Object.keys(BUILDER).length);
    const routes = [...reads.map((path) => ["GET", path] as const), ...writes.map((path) => ["POST", path] as const)];
    for (const [method, path] of routes) {
      for (const token of [undefined, "x".repeat(box.token.length), `${box.token}x`]) {
        const res = await fetch(`${box.url}${path}`, { method, headers: { origin: new URL(box.url).origin, ...(token ? { [LAUNCHER_HEADER]: token } : {}) } });
        expect(res.status, `${method} ${path} with ${token ? "a wrong" : "no"} token`).toBe(403);
      }
    }
    const status = await callJson<BuilderStatus>(box, "GET", BUILDER.status);
    expect(status).toEqual({
      provider: "sim",
      simulated: true,
      ready: { ok: true, reason: null },
      model: { provider: "off", reason: expect.any(String) },
      voice: { mode: "mock", reason: null, tts: null, stt: null },
      building: false,
    });
  });

  it("take writes only from this machine's pages", async () => {
    const { box } = await start();
    const evil = await call(box, "POST", BUILDER.start, {}, { origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    expect(await callJson(box, "GET", BUILDER.designer)).toBeNull();
    expect((await call(box, "POST", BUILDER.start, {})).status).toBe(200);
  });

  it("answer the Designer's refusals with their status and code", async () => {
    const t = await start();
    const { box } = t;
    const refusal = async (res: Response) => [res.status, res.headers.get(DESIGNER_CODE_HEADER)];
    expect(await refusal(await call(box, "POST", BUILDER.choose, { choice: "x" }))).toEqual([404, "no-session"]);
    const state = await callJson<DesignerState>(box, "POST", BUILDER.start, {});
    expect(state).toMatchObject({ step: "mechanic", locked: false, thinking: false });
    expect(await refusal(await call(box, "POST", BUILDER.choose, { choice: "nope", session: state.session }))).toEqual([400, "bad-choice"]);
    expect(await refusal(await call(box, "POST", BUILDER.answer, { text: "   ", session: state.session }))).toEqual([400, "empty"]);
    expect(await refusal(await call(box, "POST", BUILDER.back, { session: "an-older-one" }))).toEqual([409, "stale"]);
    expect(await refusal(await call(box, "POST", BUILDER.confirm, { session: state.session }))).toEqual([409, "not-ready"]);
    // What isn't a well-formed request is a plain 400.
    expect((await call(box, "POST", BUILDER.choose, { session: state.session })).status).toBe(400);
    expect((await call(box, "POST", BUILDER.answer, { text: 7 })).status).toBe(400);
    expect((await call(box, "POST", BUILDER.choose, "[1]")).status).toBe(400);
    // Typed words are read (keywords here: the model is off).
    const answered = await callJson<DesignerState>(box, "POST", BUILDER.answer, { text: "first tap wins", session: state.session });
    expect(answered.step).toBe("theme");
    expect(answered.brief.mechanic).not.toBeNull();
  });

  it("caps a recorded answer, and hears mock voice's scripted line for the question asked", async () => {
    const { box } = await start();
    const state = await callJson<DesignerState>(box, "POST", BUILDER.start, {});
    expect(await announced(box, `${BUILDER.transcribe}?session=${state.session}`, AUDIO_LIMIT + 1)).toBe(413);
    const turns = await callJson<MockTurn[]>(box, "GET", BUILDER.turns);
    expect(turns[0]).toEqual({ say: state.question, hear: "First tap wins." });
    const heard = await callJson<TranscribeReply>(box, "POST", `${BUILDER.transcribe}?session=${state.session}`, new Uint8Array(0));
    expect(heard.text).toBe("First tap wins.");
    expect(heard.state.step).toBe("theme");
    expect(await callJson(box, "POST", BUILDER.speak, { session: state.session })).toEqual({ text: heard.state.question, clip: null });
    expect((await call(box, "GET", `${BUILDER.clip}?file=../../etc/passwd`)).status).toBe(404);
  });

  it("builds on confirm: the design locks, /api/state is busy, and the stream replays the build to a late screen", async () => {
    const t = await start();
    const { box } = t;
    const early = await stream(t);
    const hello = await early.next("hello");
    expect(hello).toMatchObject({ designer: null, job: null, status: { building: false } });

    const atConfirm = await keysToConfirm(t);
    expect(await early.next("designer", (s) => s.step === "confirm")).toEqual(atConfirm);
    const { brief, job } = await callJson<ConfirmReply>(box, "POST", BUILDER.confirm, { session: atConfirm.session });
    expect(brief).toEqual(atConfirm.brief);
    expect(job).toMatchObject({ provider: "sim", brief, game: null });

    // Locked while it builds, and the deploy's updater waits.
    const locked = await call(box, "POST", BUILDER.back, { session: atConfirm.session });
    expect([locked.status, locked.headers.get(DESIGNER_CODE_HEADER)]).toEqual([409, "locked"]);
    expect(((await (await fetch(`${box.url}/api/state`)).json()) as { busy: boolean }).busy).toBe(true);
    expect(await early.next("designer", (s) => s.locked)).toMatchObject({ session: atConfirm.session, locked: true });

    // A screen that comes in mid-build gets where things stand, then the build so far, then the rest live.
    const late = await stream(t);
    const lateHello = await late.next("hello");
    expect(lateHello.job?.id).toBe(job.id);
    expect(lateHello.status.building).toBe(true);
    const result = await early.next("forge", (e) => e.type === "result", 0, 90_000);
    expect(result).toMatchObject({ type: "result", job: job.id, ok: true, error: null });
    await late.next("forge", (e) => e.type === "result");
    const seen = (s: TestStream) => s.events.filter((e) => e.event === "forge").map((e) => e.data);
    expect(seen(late)).toEqual(seen(early));

    const reply = await callJson<JobReply>(box, "GET", `${BUILDER.job}?id=${job.id}`);
    expect(reply.job).toMatchObject({ status: "done", game: (result as { game: string }).game });
    expect(reply.events).toEqual(seen(early));
    // After it: unlocked, idle, and ?job= replays a finished build on request.
    expect(await early.next("designer", (s) => !s.locked)).toMatchObject({ locked: false });
    expect(((await (await fetch(`${box.url}/api/state`)).json()) as { busy: boolean }).busy).toBe(false);
    const replay = await stream(t, `?job=${job.id}`);
    await replay.next("forge", (e) => e.type === "result");
    expect(seen(replay)).toEqual(reply.events);
    expect((await call(box, "GET", `${BUILDER.events}?job=nope`)).status).toBe(404);
  }, 120_000);

  it("lists, cancels and removes through the Forge, refusing what it won't do", async () => {
    const { box } = await start();
    expect(await callJson(box, "GET", BUILDER.jobs)).toEqual([]);
    expect((await call(box, "GET", `${BUILDER.job}?id=nope`)).status).toBe(404);
    expect((await call(box, "POST", BUILDER.cancel, { id: "nope" })).status).toBe(404);
    const team = await call(box, "POST", BUILDER.remove, { game: "tap-three" });
    expect(team.status).toBe(409);
    expect((await call(box, "POST", BUILDER.remove, {})).status).toBe(400);
  });
});
