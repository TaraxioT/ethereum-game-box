import { boxAccountAbi } from '@egb/shared/names';
import type { Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import { originAllowed } from '../src/cors.ts';
import { claimBody, executeBody, newBadge } from './bodies.ts';
import { World } from './world.ts';

describe('CORS', () => {
  it("allows the site's origin and localhost on any port", () => {
    const allowed = 'https://gamebox-names.pages.dev,http://localhost:*';
    expect(originAllowed('https://gamebox-names.pages.dev', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', allowed)).toBe(true);
    expect(originAllowed('http://localhost', allowed)).toBe(true);
    expect(originAllowed('https://evil.pages.dev', allowed)).toBe(false);
    expect(originAllowed('http://localhost.evil.com', allowed)).toBe(false);
    expect(originAllowed('http://localhost:5173', 'https://gamebox-names.pages.dev')).toBe(false);
  });

  it('refuses a request from another origin before any check', async () => {
    const world = new World();
    const res = await world.post('/names/claim', await claimBody('alice', newBadge()), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(world.chain.calls.size).toBe(0);
  });

  it('answers a preflight from the site', async () => {
    const world = new World();
    const { handle } = await import('../src/routes.ts');
    const res = await handle(
      new Request('https://relayer.test/names/claim', {
        method: 'OPTIONS',
        headers: { origin: 'https://gamebox-names.pages.dev' },
      }),
      world.deps,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://gamebox-names.pages.dev');
  });
});

describe('GET /tx/:id', () => {
  it('follows a request from sent to in-block to done', async () => {
    const world = new World();
    const { body } = await world.post('/box/execute', executeBody(world));
    const id = body.id as string;
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({ status: 'sent', hash: world.chain.sent[0]!.hash });

    world.chain.receipts.set(world.chain.sent[0]!.hash, { status: 'success', block: 101 });
    world.chain.head = 101;
    expect(await world.relay.poll()).toBe(true);
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({ status: 'in-block', block: 101, gasUsed: '150000' });

    world.chain.head = 102;
    expect(await world.relay.poll()).toBe(false);
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({ status: 'done', block: 101 });
  });

  it('names the revert of a transaction that failed in its block', async () => {
    const world = new World();
    const { body } = await world.post('/box/execute', executeBody(world));
    world.chain.receipts.set(world.chain.sent[0]!.hash, { status: 'reverted', block: 101 });
    world.reverts.set('execute', [boxAccountAbi as Abi, 'DeadlineExpired', [1n]]);
    await world.relay.poll();
    expect((await world.get(`/tx/${body.id as string}`)).body).toMatchObject({
      status: 'failed',
      revert: 'DeadlineExpired',
    });
  });

  it('404s an unknown id', async () => {
    const world = new World();
    expect((await world.get(`/tx/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe('GET /health', () => {
  it('shows the balance, the pending count and the head block', async () => {
    const world = new World();
    world.chain.balances.set(world.relayerAccount.address.toLowerCase(), 4n * 10n ** 17n);
    await world.post('/box/execute', executeBody(world));
    expect((await world.get('/health')).body).toEqual({
      address: world.relayerAccount.address,
      balance: '400000000000000000',
      pending: 1,
      block: 100,
      tipGwei: '2',
    });
  });
});

describe('errors', () => {
  it('never echoes the RPC URL', async () => {
    const world = new World();
    world.chain.contract('0x00000000000000000000000000000000000000a1', [] as Abi, {});
    const url = 'https://nd-123.p2pify.core.chainstack.com/0123456789abcdef';
    const original = world.deps.ctx.client.readContract;
    world.deps.ctx.client.readContract = (async () => {
      throw new Error(`HTTP request failed.\n\nURL: ${url}\nRequest body: {}`);
    }) as typeof original;
    const res = await world.post('/box/execute', executeBody(world));
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('chainstack');
  });

  it('refuses a body that is not JSON', async () => {
    const world = new World();
    const { handle } = await import('../src/routes.ts');
    const res = await handle(new Request('https://relayer.test/names/claim', { method: 'POST', body: 'nope' }), world.deps);
    expect(res.status).toBe(400);
  });
});
