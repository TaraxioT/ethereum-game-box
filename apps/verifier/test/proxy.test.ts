import { describe, expect, it, vi } from 'vitest';

import { LIMITS } from '../src/limits.ts';
import { type ProxyOptions, proxyTurn } from '../src/proxy.ts';
import { scrubber } from '../src/safe.ts';
import type { TeeCheck } from '../src/tee.ts';
import { FakeZg } from './fake-zg/index.ts';

const PROOF = { chatId: 'c', provider: `0x${'11'.repeat(20)}`, text: 't', signature: '0x00' } as const;
const passes: TeeCheck = { check: async () => ({ proof: PROOF }) };

function options(zg: FakeZg, tee: TeeCheck = passes): ProxyOptions {
  return { baseUrl: 'http://zg.fake/v1', apiKey: 'the-key', model: '0gm-1.0-35b-a3b', tee, fetch: zg.fetch, scrub: scrubber(['the-key']) };
}

const chat = (extra: Record<string, unknown> = {}) => JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...extra });

describe('every call to 0G', () => {
  it("carries the key and 0G's private mode, whatever the container sent", async () => {
    const zg = new FakeZg();
    await proxyTurn(options(zg), chat({ verify_tee: false, model: 'something-cheap', max_tokens: 999_999, stream: true, secret: 1 }));
    const [seen] = zg.chats;
    expect(seen?.authorization).toBe('Bearer the-key');
    expect(seen?.trustMode).toBe('private');
    expect(seen?.body).toEqual({
      model: '0gm-1.0-35b-a3b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: LIMITS.replyTokens,
      verify_tee: true,
    });
  });

  it('keeps what a chat needs', async () => {
    const zg = new FakeZg();
    const tools = [{ type: 'function', function: { name: 'shell' } }];
    await proxyTurn(options(zg), chat({ tools, tool_choice: 'required', max_tokens: 100, chat_template_kwargs: { enable_thinking: false } }));
    expect(zg.chats[0]?.body).toMatchObject({ tools, tool_choice: 'required', max_tokens: 100, chat_template_kwargs: { enable_thinking: false } });
  });
});

describe('a proven turn', () => {
  it('is recorded with its proof, and the reply goes back untouched', async () => {
    const zg = new FakeZg();
    const result = await proxyTurn(options(zg), chat());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn).toMatchObject({ chatId: 'c', model: '0gm-1.0-35b-a3b', teeVerified: true, response: { proof: PROOF } });
    expect(JSON.parse(result.reply)).toHaveProperty('x_0g_trace');
    expect(result.turn.request).not.toHaveProperty('authorization');
  });
});

describe("a turn's cost", () => {
  const tokensOf = async (zg: FakeZg, text: string) => {
    const result = await proxyTurn(options(zg), text);
    return result.ok ? result.tokens : null;
  };

  it('is what 0G says', async () => {
    const zg = new FakeZg();
    zg.settings.usageTokens = 1234;
    expect(await tokensOf(zg, chat())).toBe(1234);
  });

  it.each([
    ['no usage', null],
    ['a usage below zero', -5],
  ])('is estimated from the bytes with %s', async (_name, usageTokens) => {
    const zg = new FakeZg();
    zg.settings.usageTokens = usageTokens;
    const tokens = await tokensOf(zg, chat({ pad: 'x'.repeat(30_000) }));
    expect(tokens).toBeGreaterThan(10_000);
    expect(tokens).toBeLessThan(11_000);
  });
});

describe('a turn that fails', () => {
  it('is not proven when the check says so, and its reply stays here', async () => {
    const result = await proxyTurn(options(new FakeZg(), { check: async () => ({ problem: 'no' }) }), chat());
    expect(result).toMatchObject({ ok: false, failure: { kind: 'tee', why: 'no' }, turn: { teeVerified: false } });
    expect(result).not.toHaveProperty('reply');
  });

  it('is not proven when the check itself throws, and the error is scrubbed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tee = { check: () => Promise.reject(new Error('read failed at https://rpc.example/the-key')) };
    const result = await proxyTurn(options(new FakeZg(), tee), chat());
    expect(result).toMatchObject({ ok: false, failure: { kind: 'tee' }, turn: { teeVerified: false } });
    expect(JSON.stringify(error.mock.calls)).not.toContain('the-key');
    error.mockRestore();
  });

  it('says 0G is unreachable, with nothing from the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const zg = new FakeZg();
    const fetch = () => Promise.reject(new Error('connect failed to http://zg.fake/?key=the-key'));
    const result = await proxyTurn({ ...options(zg), fetch }, chat());
    expect(result).toMatchObject({ ok: false, failure: { kind: 'zg', why: "0G can't be reached" } });
    expect(JSON.stringify([result, error.mock.calls])).not.toContain('the-key');
    error.mockRestore();
  });

  it('fails on a status that is not 200', async () => {
    const zg = new FakeZg();
    zg.settings.chat = 'error';
    expect(await proxyTurn(options(zg), chat())).toMatchObject({ ok: false, failure: { kind: 'zg', why: '0G answered 500' } });
  });

  it("fails on a reply that isn't JSON", async () => {
    const fetch = async () => new Response('<html>');
    expect(await proxyTurn({ ...options(new FakeZg()), fetch }, chat())).toMatchObject({ ok: false, failure: { kind: 'zg' } });
  });

  it('fails on a reply over the limit, before checking it', async () => {
    const tee = { check: vi.fn() };
    const fetch = async () => new Response(JSON.stringify({ big: 'x'.repeat(LIMITS.turnBytes) }));
    expect(await proxyTurn({ ...options(new FakeZg(), tee), fetch }, chat())).toMatchObject({ ok: false, failure: { kind: 'zg' } });
    expect(tee.check).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'nope'],
    ['not a chat', '{"prompt":"hi"}'],
  ])('never reaches 0G when the request is %s', async (_name, text) => {
    const zg = new FakeZg();
    expect(await proxyTurn(options(zg), text)).toMatchObject({ ok: false, turn: null, failure: { kind: 'container' } });
    expect(zg.chats).toHaveLength(0);
  });
});
