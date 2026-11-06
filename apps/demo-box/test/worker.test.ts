// No throw reaches the runtime: every route of the demo Box answers JSON, before the deploy and on any failure.

import { describe, expect, it } from 'vitest';

import type { Env } from '../src/env.ts';
import worker from '../src/index.ts';

const failing = (message: string) =>
  ({
    DEMO_BOX: {
      idFromName: () => 'id',
      get: () => ({
        start: async () => {
          throw new Error(message);
        },
      }),
    },
    ALLOWED_ORIGINS: 'https://gamebox-names.pages.dev',
  }) as unknown as Env;

const fetch = (env: Env, path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://demo-box.test${path}`, init) as Parameters<typeof worker.fetch>[0], env);

describe('the demo Box Worker', () => {
  it('answers 503 JSON before the contracts are deployed', async () => {
    const env = failing('DemoBoxAccount is not in deployments/sepolia.json');
    for (const [path, init] of [
      ['/box', undefined],
      ['/result', { method: 'POST', body: '{}' }],
      ['/agent', undefined],
      ['/agent/setup', { method: 'POST' }],
      ['/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }],
    ] as const) {
      const res = await fetch(env, path, init);
      expect(res.status, path).toBe(503);
      expect(await res.json()).toEqual({ error: 'not deployed: DemoBoxAccount is not in deployments/sepolia.json' });
    }
  });

  it('answers 502 JSON on any other failure, without the RPC URL', async () => {
    const res = await fetch(failing('request to https://nd-1.p2pify.core.chainstack.com/key failed'), '/box');
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('chainstack');
  });

  it('refuses another origin', async () => {
    const res = await fetch(failing('unused'), '/box', { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});
