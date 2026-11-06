// The container's HTTP server. `POST /run` is the Worker's one job, and whatever comes of it, the container is finished:
// a second job is refused, even from the agent's own shell, which can reach this port.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { AgentRunRequest, AgentVerdict } from "@egb/shared/store";

import { runAgent } from "./agent.ts";
import { RunFailure } from "./failure.ts";
import type { Limits } from "./limits.ts";
import { isRecord } from "./record.ts";
import type { Sandbox } from "./shell.ts";
import { makeWorkFolder } from "./workdir.ts";

export interface ServerOptions {
  readonly modelUrl: string;
  readonly sandbox: Sandbox;
  readonly limits: Limits;
  /** Where the work folder goes. */
  readonly workRoot: string;
  /** Called once, after the job's answer has gone or the Worker has stopped waiting. */
  readonly onDone: () => void;
}

/** A body that isn't a job, with its HTTP status. */
class Refusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const send = (res: ServerResponse, status: number, body: object): void => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new Refusal(413, "the job is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJob(text: string): AgentRunRequest {
  let job: unknown;
  try {
    job = JSON.parse(text);
  } catch {
    throw new Refusal(400, "the job isn't JSON");
  }
  if (!isRecord(job) || typeof job.instructions !== "string" || job.instructions === "") {
    throw new Refusal(400, "the job has no instructions");
  }
  if (typeof job.log !== "string" || job.log === "") throw new Refusal(400, "the job has no log");
  return { instructions: job.instructions, log: job.log };
}

async function judge(req: IncomingMessage, options: ServerOptions, signal: AbortSignal): Promise<AgentVerdict> {
  const { modelUrl, sandbox, limits, workRoot } = options;
  const job = parseJob(await readBody(req, limits.requestBytes));
  const folder = await makeWorkFolder(job, workRoot);
  return runAgent({ modelUrl, sandbox, limits, folder, signal });
}

async function run(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  const caller = new AbortController();
  res.once("close", () => {
    caller.abort();
    options.onDone();
  });
  try {
    send(res, 200, { verdict: await judge(req, options, caller.signal) });
  } catch (error) {
    if (error instanceof Refusal) send(res, error.status, { error: error.message });
    else if (error instanceof RunFailure) send(res, 500, { error: error.message });
    else {
      console.error(error);
      send(res, 500, { error: "the run failed" });
    }
  }
}

export function createJobServer(options: ServerOptions): Server {
  let taken = false;
  return createServer((req, res) => {
    const route = `${req.method} ${req.url}`;
    if (route === "GET /health") return send(res, 200, { ok: true });
    if (route !== "POST /run") return send(res, 404, { error: "no such route" });
    if (taken) return send(res, 409, { error: "this container has had its job" });
    taken = true;
    void run(req, res, options);
  });
}
