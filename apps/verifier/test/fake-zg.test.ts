// The fake over real HTTP, through the real check and the real chain reader: what the end-to-end harness will see.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { proxyTurn } from '../src/proxy.ts';
import { scrubber } from '../src/safe.ts';
import { SignedChatCheck } from '../src/tee.ts';
import { zgServices, zgTransport } from '../src/zg-chain.ts';
import { SERVING_CONTRACT } from './fake-zg/index.ts';
import { type RunningFakeZg, startFakeZg } from './fake-zg/server.ts';

let running: RunningFakeZg;

beforeAll(async () => {
  running = await startFakeZg();
});

afterAll(() => running.close());

const options = () => ({
  baseUrl: `${running.url}/v1`,
  apiKey: 'test',
  model: '0gm-1.0-35b-a3b',
  tee: new SignedChatCheck({
    services: zgServices(SERVING_CONTRACT, zgTransport(`${running.url}/rpc`)),
    fetch,
    sleep: async () => undefined,
  }),
  fetch,
  scrub: scrubber([]),
});

const turn = (messages: unknown[] = [{ role: 'user', content: 'Judge.' }]) => proxyTurn(options(), JSON.stringify({ messages }));

describe('the fake 0G', () => {
  it('proves a turn the way mainnet does', async () => {
    const result = await turn();
    expect(result).toMatchObject({ ok: true, turn: { teeVerified: true, response: { proof: { provider: running.fake.provider } } } });
  });

  it('calls the shell first, then submits what it was told', async () => {
    await fetch(`${running.url}/__fake`, { method: 'POST', body: JSON.stringify({ payouts: ['2', '0'], chat: 'none' }) });
    const first = await turn();
    expect(first.ok && first.reply).toContain('"name":"shell"');
    const second = await turn([{ role: 'tool', content: '{}' }]);
    expect(second.ok && second.reply).toContain('submit_verdict');
    expect(second.ok && second.reply).toContain('\\"payouts\\":[\\"2\\",\\"0\\"]');
  });

  it('can be told to fail a proof', async () => {
    await fetch(`${running.url}/__fake`, { method: 'POST', body: JSON.stringify({ chat: 'bad-signature' }) });
    expect(await turn()).toMatchObject({ ok: false, failure: { kind: 'tee' } });
    await fetch(`${running.url}/__fake`, { method: 'POST', body: JSON.stringify({ chat: 'none' }) });
  });

  it('says what it has seen', async () => {
    const reply = (await (await fetch(`${running.url}/__fake`)).json()) as { chats: number };
    expect(reply.chats).toBeGreaterThan(0);
  });
});
