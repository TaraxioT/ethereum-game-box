// No throw reaches the runtime: every route of the Worker answers JSON, before the deploy and without its secrets.

import { describe, expect, it } from 'vitest';

import type { Env } from '../src/env.ts';
import { guarded } from '../src/guard.ts';
import worker from '../src/index.ts';
import { executeBody } from './bodies.ts';
import { World } from './world.ts';

const notDeployed = () => {
  throw new Error('GameBoxNames is not in deployments/sepolia.json');
};

describe('guarded', () => {
  it('turns a missing deployment into a 503 and anything else into a 502, as JSON', async () => {
    const a = await guarded(async () => notDeployed());
    expect(a.status).toBe(503);
    expect(await a.json()).toEqual({ error: 'not deployed: GameBoxNames is not in deployments/sepolia.json' });
    const b = await guarded(() => {
      throw new Error('fetch failed at https://nd-1.p2pify.core.chainstack.com/secret');
    });
    expect(b.status).toBe(502);
    expect(JSON.stringify(await b.json())).not.toContain('chainstack');
  });

  it('answers a route with 503 before the contracts are deployed', async () => {
    const world = new World();
    Object.defineProperty(world.deps.ctx, 'addresses', { get: notDeployed });
    const res = await world.post('/account/execute', executeBody(world));
    expect(res).toEqual({ status: 503, body: { error: 'not deployed: GameBoxNames is not in deployments/sepolia.json' } });
    expect(await world.get('/health')).toMatchObject({ status: 200 });
  });
});

describe('the Worker', () => {
  const env = {
    SENDER: {
      idFromName: () => 'id',
      get: () => ({
        health: async () => {
          throw new Error('the Durable Object failed');
        },
      }),
    },
    RELAYER_PRIVATE_KEY: '',
    SEPOLIA_RPC_URL: 'https://example.invalid/key',
    ALLOWED_ORIGINS: 'https://gamebox-names.pages.dev',
  } as unknown as Env;
  const fetch = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://relayer.test${path}`, init) as Parameters<typeof worker.fetch>[0], env);

  it('answers JSON on every route, even without its secrets', async () => {
    for (const [path, init] of [
      ['/health', undefined],
      ['/tx/00000000-0000-0000-0000-000000000000', undefined],
      ['/names/claim', { method: 'POST', body: '{}' }],
      ['/nowhere', undefined],
    ] as const) {
      const res = await fetch(path, init);
      expect(res.headers.get('content-type'), path).toMatch(/json/);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await res.json())).not.toContain('example.invalid');
    }
  });
});
