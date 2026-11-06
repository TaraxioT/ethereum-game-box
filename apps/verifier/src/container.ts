// The agent's container: no secrets, no internet, one job. `enableInternet = false` and a handler for one host are all
// the way out it gets: with only `outboundByHost` set, only `zg.internal` even resolves. The handler runs here in the
// Worker, outside the container, so the keys stay on this side of it.

import { Container, type OutboundHandlerContext } from '@cloudflare/containers';
import type { AgentRunRequest } from '@egb/shared/store';

import { boundedText } from './body.ts';
import type { Env } from './env.ts';
import { failed } from './failure.ts';
import type { AgentRunner, RunResult, Ticket } from './judge.ts';
import { isRecord, parsed } from './json.ts';
import { LIMITS } from './limits.ts';
import type { Scrub } from './safe.ts';

const TICKET = 'ticket';
const PORT = 8080;
const MODEL_PATH = '/v1/chat/completions';
const WATCH_MS = 1000;
/** A container exits the moment it has answered, so its answer gets this long to arrive after the exit. */
const ANSWER_GRACE_MS = 2000;

/** What the container answered `POST /run` with. */
export interface RunReply {
  readonly status: number;
  readonly text: string;
}

/** Any model call from a container lands here. A container's ticket is kept with its Durable Object, so the code inside
 *  can't claim to be another run. */
export async function zgOutbound(request: Request, env: Env, ctx: OutboundHandlerContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== 'POST' || pathname !== MODEL_PATH) return Response.json({ error: 'not found' }, { status: 404 });
  const ticket = await env.AGENT.get(env.AGENT.idFromString(ctx.containerId)).ticket();
  if (!ticket) return Response.json({ error: 'this container has no run' }, { status: 403 });
  // Counted here, before it can fill this isolate: the agent's shell can stream anything at this handler.
  const text = await boundedText(request, LIMITS.turnBytes);
  if (text === null) return Response.json({ error: 'a model call is too large' }, { status: 413 });
  const { status, body } = await env.JUDGEMENT.getByName(ticket.judgement).modelTurn(ticket.attempt, text);
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AgentContainer extends Container<Env> {
  override defaultPort = PORT;
  override enableInternet = false;
  override pingEndpoint = 'container/health';
  override sleepAfter = '10m';

  ticket(): Promise<Ticket | undefined> {
    return this.ctx.storage.get<Ticket>(TICKET);
  }

  /** Starts the container and gives it its one job. */
  async run(ticket: Ticket, job: AgentRunRequest): Promise<RunReply> {
    await this.ctx.storage.put(TICKET, ticket);
    await this.startAndWaitForPorts({ cancellationOptions: { instanceGetTimeoutMS: 30_000, portReadyTimeoutMS: 60_000 } });
    return Promise.race([this.ask(job), this.dies()]);
  }

  private async ask(job: AgentRunRequest): Promise<RunReply> {
    const response = await this.containerFetch('http://container/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    });
    return { status: response.status, text: await response.text() };
  }

  /** Rejects if the container stops without answering: a call to a killed container can otherwise hang. */
  private async dies(): Promise<never> {
    while (this.ctx.container?.running) await sleep(WATCH_MS);
    await sleep(ANSWER_GRACE_MS);
    throw new Error('the container stopped');
  }
}

// Assigned, not a `static` field: a field would shadow the setter that registers the handler, and every call would be
// refused (see the container test).
AgentContainer.outboundByHost = { 'zg.internal': zgOutbound };

/** What a container's answer comes to. `RunFailure` messages are our own, but the server is on the far side of an
 *  agent's shell, so only the status is believed. */
export function readRunReply({ status, text }: RunReply): RunResult {
  if (status !== 200) return { failure: failed('container', `the container answered ${status}`) };
  const reply = parsed(text);
  if (!isRecord(reply)) return { failure: failed('container', "the container's answer isn't JSON") };
  return { verdict: reply.verdict };
}

const STOPPED = Symbol('stopped');

/** Each attempt is a new Durable Object, so each gets a fresh container, and it is destroyed however the run ends. */
export function containerRunner(env: Pick<Env, 'AGENT'>, scrub: Scrub): AgentRunner {
  return {
    async run(ticket, job) {
      const container = env.AGENT.getByName(`${ticket.judgement}:${ticket.attempt}`);
      try {
        const reply = await Promise.race([container.run(ticket, job), sleep(LIMITS.runMs).then((): typeof STOPPED => STOPPED)]);
        return reply === STOPPED ? { failure: failed('timeout', 'the run timed out') } : readRunReply(reply);
      } catch (error) {
        console.error(`the container failed: ${scrub(error)}`);
        return { failure: failed('container', 'the container failed') };
      } finally {
        await container.destroy().catch(() => undefined);
      }
    },
  };
}
