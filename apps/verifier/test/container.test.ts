import { Container, ContainerProxy } from '@cloudflare/containers';
import { describe, expect, it, vi } from 'vitest';

import { AgentContainer, containerRunner, readRunReply, zgOutbound } from '../src/container.ts';
import type { Env } from '../src/env.ts';
import type { Ticket } from '../src/judge.ts';
import { LIMITS } from '../src/limits.ts';
import { scrubber } from '../src/safe.ts';
import { endlessBody } from './world.ts';

const CONTAINER_ID = 'a'.repeat(64);
const TICKET: Ticket = { judgement: 'mumbai-01:42', attempt: 2 };

/** The slice of a Durable Object's state the real `Container` constructor reads. */
function fakeState() {
  const kv = new Map<string, unknown>();
  return {
    id: { toString: () => CONTAINER_ID },
    exports: { ContainerProxy: () => ({}) },
    container: { running: false as boolean, monitor: () => Promise.resolve(), interceptOutboundHttp: async () => undefined },
    storage: {
      kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => kv.set(key, value) },
      sql: { exec: () => ({ toArray: () => [], [Symbol.iterator]: () => [][Symbol.iterator]() }) },
      get: async () => undefined,
      put: async () => undefined,
      sync: async () => undefined,
      setAlarm: async () => undefined,
      getAlarm: async () => null,
      deleteAlarm: async () => undefined,
    },
    blockConcurrencyWhile: async (run: () => Promise<void>) => run(),
  };
}

const agent = () => new AgentContainer(fakeState() as never, {} as Env);

function env(ticket: Ticket | undefined, modelTurn = vi.fn(async () => ({ status: 200, body: '{"ok":true}' }))) {
  return {
    modelTurn,
    env: {
      AGENT: { idFromString: (id: string) => id, get: () => ({ ticket: async () => ticket }) },
      JUDGEMENT: { getByName: vi.fn(() => ({ modelTurn })) },
    } as unknown as Env,
  };
}

const proxied = (url: string, bindings: Env, init: RequestInit = { method: 'POST', body: '{}' }) => {
  const proxy = new (ContainerProxy as unknown as new (ctx: object, env: Env) => ContainerProxy)(
    { props: { className: 'AgentContainer', containerId: CONTAINER_ID, enableInternet: false, interceptAll: false } },
    bindings,
  );
  return proxy.fetch(new Request(url, init));
};

describe('the container', () => {
  it('has no internet, no secrets and no other way out', () => {
    const container = agent();
    expect(container).toBeInstanceOf(Container);
    expect(container.enableInternet).toBe(false);
    expect(container.envVars).toEqual({});
    expect(container.entrypoint).toBeUndefined();
    expect(container.interceptHttps).toBe(false);
    expect(container.allowedHosts).toBeUndefined();
    expect(Object.keys(AgentContainer.outboundByHost ?? {})).toEqual(['zg.internal']);
    expect(AgentContainer.outbound).toBeUndefined();
    expect(AgentContainer.outboundHandlers).toBeUndefined();
  });

  it('listens where the container does', () => {
    expect(agent().defaultPort).toBe(8080);
  });
});

describe('the way out', () => {
  it('reaches the proxy through the real outbound chain', async () => {
    const { env: bindings, modelTurn } = env(TICKET);
    const response = await proxied('http://zg.internal/v1/chat/completions', bindings);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(modelTurn).toHaveBeenCalledWith(2, '{}');
    expect(bindings.JUDGEMENT.getByName).toHaveBeenCalledWith('mumbai-01:42');
  });

  it('is shut for every other host', async () => {
    const { env: bindings, modelTurn } = env(TICKET);
    const response = await proxied('http://evil.example/steal', bindings);
    expect(response.status).toBe(520);
    expect(modelTurn).not.toHaveBeenCalled();
  });

  it('refuses a container that has no run', async () => {
    const { env: bindings, modelTurn } = env(undefined);
    const response = await zgOutbound(
      new Request('http://zg.internal/v1/chat/completions', { method: 'POST', body: '{}' }),
      bindings,
      { containerId: CONTAINER_ID, className: 'AgentContainer' },
    );
    expect(response.status).toBe(403);
    expect(modelTurn).not.toHaveBeenCalled();
  });

  it('refuses a body over the limit from a count of what arrived, and reads no further', async () => {
    const { env: bindings, modelTurn } = env(TICKET);
    const body = endlessBody(64 * 1024 * 1024);
    const request = new Request('http://zg.internal/v1/chat/completions', { method: 'POST', body: body.stream, duplex: 'half' } as RequestInit);
    const response = await zgOutbound(request, bindings, { containerId: CONTAINER_ID, className: 'AgentContainer' });
    expect(response.status).toBe(413);
    expect(modelTurn).not.toHaveBeenCalled();
    expect(body.pulled()).toBeLessThanOrEqual(LIMITS.turnBytes + 64 * 1024);
  });

  it.each([
    ['GET', 'http://zg.internal/v1/chat/completions'],
    ['POST', 'http://zg.internal/v1/embeddings'],
    ['POST', 'http://zg.internal/__fake'],
  ])('refuses %s %s', async (method, url) => {
    const { env: bindings, modelTurn } = env(TICKET);
    const response = await zgOutbound(new Request(url, { method }), bindings, { containerId: CONTAINER_ID, className: 'AgentContainer' });
    expect(response.status).toBe(404);
    expect(modelTurn).not.toHaveBeenCalled();
  });
});

describe('a run', () => {
  /** A container that started and is running, with the real `run`. */
  function started(ask: () => Promise<Response>) {
    const state = fakeState();
    const container = new AgentContainer(state as never, {} as Env);
    state.container.running = true;
    vi.spyOn(container, 'startAndWaitForPorts').mockResolvedValue();
    vi.spyOn(container, 'containerFetch').mockImplementation(ask);
    return { container, state };
  }

  it("knows the real library's error for a pool with no instance free, and asks nothing", async () => {
    vi.useFakeTimers();
    const noInstance = new Error('there is no container instance that can be provided to this durable object');
    const rejected = () => {
      const failure = Promise.reject(noInstance);
      failure.catch(() => undefined);
      return failure;
    };
    const state = fakeState();
    Object.assign(state.container, { start: () => undefined, monitor: rejected, getTcpPort: () => ({ fetch: rejected }) });
    const container = new AgentContainer(state as never, {} as Env);
    const ask = vi.spyOn(container, 'containerFetch');
    const reply = container.run(TICKET, { instructions: 'i', log: 'l' });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await reply).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('lets any other failure to start through', async () => {
    const { container } = started(async () => new Response('{}'));
    vi.spyOn(container, 'startAndWaitForPorts').mockRejectedValue(new Error('Container exited before we could determine the container health, exit code: 1'));
    await expect(container.run(TICKET, { instructions: 'i', log: 'l' })).rejects.toThrow('exit code: 1');
  });

  it('hands back what the container answered', async () => {
    const { container, state } = started(async () => new Response('{"verdict":1}'));
    const reply = await container.run(TICKET, { instructions: 'i', log: 'l' });
    state.container.running = false;
    expect(reply).toEqual({ status: 200, text: '{"verdict":1}' });
  });

  it('keeps an answer that lands just as the container exits', async () => {
    vi.useFakeTimers();
    const { container, state } = started(() => new Promise((resolve) => setTimeout(() => resolve(new Response('{"verdict":1}')), 1500)));
    const reply = container.run(TICKET, { instructions: 'i', log: 'l' });
    await vi.advanceTimersByTimeAsync(0);
    state.container.running = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await reply).toEqual({ status: 200, text: '{"verdict":1}' });
    vi.useRealTimers();
  });

  it('fails soon after the container dies, though the call never returns', async () => {
    vi.useFakeTimers();
    const { container, state } = started(() => new Promise(() => undefined));
    const reply = container.run(TICKET, { instructions: 'i', log: 'l' });
    const seen = expect(reply).rejects.toThrow('the container stopped');
    await vi.advanceTimersByTimeAsync(5000);
    state.container.running = false;
    await vi.advanceTimersByTimeAsync(4000);
    await seen;
    vi.useRealTimers();
  });
});

describe('an answer from the container', () => {
  it('holds the verdict', () => {
    expect(readRunReply({ status: 200, text: '{"verdict":{"kind":"cannot_judge","why":"no"}}' })).toEqual({
      verdict: { kind: 'cannot_judge', why: 'no' },
    });
  });

  it.each([
    [500, '{"error":"the model timed out"}'],
    [409, '{"error":"this container has had its job"}'],
    [503, 'There is no Container instance available'],
    [200, 'not json'],
  ])('fails the run on %i %s, quoting none of it', (status, text) => {
    const result = readRunReply({ status, text });
    expect(result).toHaveProperty('failure.kind', 'container');
    expect(JSON.stringify(result)).not.toContain(text);
  });
});

describe('the runner', () => {
  const stub = (run: () => Promise<unknown>) => {
    const destroy = vi.fn(async () => undefined);
    const getByName = vi.fn(() => ({ run, destroy }));
    return { destroy, getByName, env: { AGENT: { getByName } } as unknown as Pick<Env, 'AGENT'> };
  };
  const job = { instructions: 'i', log: 'l' };
  const scrub = scrubber([]);

  it('names a fresh container per attempt, and destroys it after', async () => {
    const { env: bindings, getByName, destroy } = stub(async () => ({ status: 200, text: '{"verdict":1}' }));
    expect(await containerRunner(bindings, scrub).run(TICKET, job)).toEqual({ verdict: 1 });
    expect(getByName).toHaveBeenCalledWith('mumbai-01:42:2');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('turns a dead container into a failure, and destroys it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { env: bindings, destroy } = stub(() => Promise.reject(new Error('Network connection lost')));
    expect(await containerRunner(bindings, scrub).run(TICKET, job)).toEqual({ failure: { kind: 'container', why: 'the container failed' } });
    expect(destroy).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('says the pool was full, and destroys what it asked for', async () => {
    const { env: bindings, destroy } = stub(async () => null);
    expect(await containerRunner(bindings, scrub).run(TICKET, job)).toEqual({ failure: { kind: 'full', why: 'no container was free' } });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('times out a run that hangs, and destroys it', async () => {
    vi.useFakeTimers();
    const { env: bindings, destroy } = stub(() => new Promise(() => undefined));
    const result = containerRunner(bindings, scrub).run(TICKET, job);
    await vi.advanceTimersByTimeAsync(LIMITS.runMs);
    expect(await result).toEqual({ failure: { kind: 'timeout', why: 'the run timed out' } });
    expect(destroy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
