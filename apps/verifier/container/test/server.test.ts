import { request, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "../src/limits.ts";
import { createJobServer } from "../src/server.ts";
import { type FakeModel, listen, type Script, shellCall, startFakeModel, steps, verdictCall } from "./fake-model.ts";
import { bashSandbox, FAST_LIMITS, JOB, workRoot } from "./fixtures.ts";

const VERDICT = { kind: "split", payouts: ["10000000", "0"], why: "A won" };

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

interface Running {
  readonly url: string;
  readonly model: FakeModel;
  readonly onDone: ReturnType<typeof vi.fn>;
}

async function start(script: Script, requestBytes = LIMITS.requestBytes): Promise<Running> {
  const model = await startFakeModel(script);
  const onDone = vi.fn();
  const server: Server = createJobServer({
    modelUrl: model.url,
    sandbox: bashSandbox,
    limits: { ...FAST_LIMITS, requestBytes },
    workRoot: await workRoot(),
    onDone,
  });
  const port = await listen(server, 0);
  cleanups.push(() => model.close(), () => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${port}`, model, onDone };
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(`${url}/run`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("the job server", () => {
  it("answers /health", async () => {
    const { url, onDone } = await start(steps(verdictCall(VERDICT)));
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("answers a job with { verdict }, then finishes", async () => {
    const { url, onDone } = await start(steps(shellCall("cat log.json"), verdictCall(VERDICT)));
    const response = await post(url, JOB);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verdict: VERDICT });
    await expect.poll(() => onDone.mock.calls.length).toBe(1);
  });

  it("answers cannot_judge as a verdict", async () => {
    const { url } = await start(steps(verdictCall({ kind: "cannot_judge", why: "no taps" })));
    const response = await post(url, JOB);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verdict: { kind: "cannot_judge", why: "no taps" } });
  });

  it("refuses a second job while the first runs", async () => {
    let answer = (): void => {};
    const proceeded = new Promise<void>((resolve) => (answer = resolve));
    const { url, model, onDone } = await start(() => {
      answer();
      return { hang: true };
    });
    const first = post(url, JOB).catch(() => null);
    await proceeded;
    const second = await post(url, JOB);
    expect(second.status).toBe(409);
    expect(model.requests).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
    await first;
  });

  it("refuses a second job after the first has ended", async () => {
    const { url, model } = await start(steps(verdictCall(VERDICT)));
    await post(url, JOB);
    expect((await post(url, JOB)).status).toBe(409);
    expect(model.requests).toHaveLength(1);
  });

  it("answers a failed run with an error, then finishes", async () => {
    const { url, onDone } = await start(steps({ die: true }));
    const response = await post(url, JOB);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "the model can't be reached" });
    await expect.poll(() => onDone.mock.calls.length).toBe(1);
  });

  it.each([
    ["isn't JSON", "not json", "the job isn't JSON"],
    ["isn't an object", "null", "the job has no instructions"],
    ["has no instructions", { log: "{}" }, "the job has no instructions"],
    ["has no log", { instructions: "x" }, "the job has no log"],
    ["has a log that isn't text", { instructions: "x", log: {} }, "the job has no log"],
  ])("refuses a body that %s", async (_name, body, error) => {
    const { url, model, onDone } = await start(steps(verdictCall(VERDICT)));
    const response = await post(url, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(model.requests).toHaveLength(0);
    await expect.poll(() => onDone.mock.calls.length).toBe(1);
  });

  it("refuses a body over the limit", async () => {
    const { url, model } = await start(steps(verdictCall(VERDICT)), 100);
    const response = await post(url, { instructions: "x", log: "y".repeat(200) });
    expect(response.status).toBe(413);
    expect(model.requests).toHaveLength(0);
  });

  it("answers 404 for anything else", async () => {
    const { url, onDone } = await start(steps(verdictCall(VERDICT)));
    expect((await fetch(`${url}/run`)).status).toBe(404);
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("stops the run and finishes when the Worker stops waiting", async () => {
    const { url, model, onDone } = await start(steps(shellCall("sleep 0.3"), verdictCall(VERDICT)));
    const { hostname, port } = new URL(url);
    const body = JSON.stringify(JOB);
    const call = request({ hostname, port, path: "/run", method: "POST", headers: { "content-length": body.length } });
    call.on("error", () => {});
    call.end(body);
    await expect.poll(() => model.requests.length).toBe(1);
    call.destroy();
    await expect.poll(() => onDone.mock.calls.length).toBe(1);
    await delay(600);
    expect(model.requests).toHaveLength(1);
  });
});
