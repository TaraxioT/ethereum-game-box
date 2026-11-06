import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiRefusal, relayerClient } from './relayer.ts';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('relayerClient', () => {
  it('posts JSON to the route and returns the 202', async () => {
    const fetch = stubFetch(202, { id: 't1', kind: 'deploy', status: 'signed' });
    const view = await relayerClient('/_relayer').deploy({ qx: '0x01', qy: '0x02' });
    expect(view.id).toBe('t1');
    expect(fetch).toHaveBeenCalledWith('/_relayer/account/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qx: '0x01', qy: '0x02' }),
    });
  });

  it('gets a request by id, escaped', async () => {
    const fetch = stubFetch(200, { id: 'a/b', kind: 'execute', status: 'done' });
    await relayerClient('https://r.test').tx('a/b');
    expect(fetch.mock.calls[0]![0]).toBe('https://r.test/tx/a%2Fb');
  });

  it('throws a refusal with its reason and revert', async () => {
    stubFetch(400, { error: 'eth_call reverted', revert: 'UnknownBox' });
    const err = await relayerClient('').execute({ account: '0x0000000000000000000000000000000000000001', nonce: '1', deadline: '2', signature: '0x', calls: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRefusal);
    expect((err as ApiRefusal).status).toBe(400);
    expect((err as ApiRefusal).message).toBe('UnknownBox');
  });

  it('survives a body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(relayerClient('').health()).rejects.toThrow('HTTP 502');
  });
});
