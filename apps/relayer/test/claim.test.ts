import { gameBoxNamesAbi } from '@egb/shared/names';
import type { Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import { CREATES_STORAGE_GAS } from '../src/request.ts';
import { accountClaimBody, claimBody, newBadge } from './bodies.ts';
import { NOW, World, addresses, boxKey } from './world.ts';

const AGENT = '0x00000000000000000000000000000000000000D2';

describe('POST /names/claim', () => {
  it('sends claimPlayer with the explicit gas limit once every check passes', async () => {
    const world = new World();
    const res = await world.post('/names/claim', await claimBody('alice', newBadge()));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ kind: 'claim', status: 'sent' });
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]).toMatchObject({ to: addresses.names, gas: CREATES_STORAGE_GAS, nonce: 0 });
  });

  it("takes a contract account's ERC-1271 signature (an agent's P256Account)", async () => {
    const world = new World();
    const key = boxKey();
    world.addAccount(AGENT, key);
    const res = await world.post('/names/claim', accountClaimBody(world, 'bot', AGENT, key));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(world.chain.sent).toHaveLength(1);
  });

  it("refuses a contract account whose isValidSignature says no, even if the signature is the key's", async () => {
    const world = new World();
    const key = boxKey();
    world.addAccount(AGENT, key);
    const body = accountClaimBody(world, 'bot', AGENT, key);
    world.erc1271.clear();
    const res = await world.post('/names/claim', body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not signed by the badge/);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses an ECDSA signature for a contract account', async () => {
    const world = new World();
    const badge = newBadge();
    world.addAccount(badge.address, boxKey());
    const res = await world.post('/names/claim', await claimBody('alice', badge));
    expect(res.status).toBe(401);
    expect(world.chain.sent).toHaveLength(0);
  });

  const refusals: [string, (world: World) => Promise<unknown>, number, RegExp][] = [
    ['a bad label', async () => claimBody('Al', newBadge()), 400, /label: at least 3/],
    ['a label with a hyphen at the end', async () => claimBody('alice-', newBadge()), 400, /label: no hyphen/],
    ['an expired deadline', async () => claimBody('alice', newBadge(), { deadline: BigInt(NOW - 1) }), 400, /deadline/],
    ['the wrong signer', async () => claimBody('alice', newBadge(), { signer: newBadge() }), 401, /not signed by the badge/],
    ['a garbage signature', async () => ({ ...(await claimBody('alice', newBadge())), signature: '0x1234' }), 401, /not signed/],
    [
      'a taken label',
      async (world) => {
        world.register('alice');
        return claimBody('alice', newBadge());
      },
      409,
      /alice.gamebox.eth is taken/,
    ],
    [
      'a badge that already has a name',
      async (world) => {
        const badge = newBadge();
        world.players.set(badge.address.toLowerCase(), 'bob');
        return claimBody('alice', badge);
      },
      409,
      /already holds bob.gamebox.eth/,
    ],
    ['a Box label', async () => claimBody('mumbai-01', newBadge()), 409, /is a Box name/],
    [
      'an eth_call revert, passed on by name',
      async (world) => {
        world.reverts.set('claimPlayer', [gameBoxNamesAbi as Abi, 'StatsWriterNotSet', []]);
        return claimBody('alice', newBadge());
      },
      422,
      /reverts with StatsWriterNotSet/,
    ],
  ];

  for (const [what, body, status, reason] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/names/claim', await body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
      expect(world.chain.calls.get('eth_sendRawTransaction')).toBeUndefined();
    });
  }

  it('names the revert in the body', async () => {
    const world = new World();
    world.reverts.set('claimPlayer', [gameBoxNamesAbi as Abi, 'BadgeHasName', [newBadge().address, 'bob']]);
    const res = await world.post('/names/claim', await claimBody('alice', newBadge()));
    expect(res.body).toMatchObject({ revert: 'BadgeHasName' });
  });

  it('refuses a replayed claim and sends it only once', async () => {
    const world = new World();
    const body = await claimBody('alice', newBadge());
    expect((await world.post('/names/claim', body)).status).toBe(202);
    const again = await world.post('/names/claim', body);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/replay/);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('refuses a second claim of a label while the first is pending', async () => {
    const world = new World();
    await world.post('/names/claim', await claimBody('alice', newBadge()));
    const second = await world.post('/names/claim', await claimBody('alice', newBadge()));
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/label:alice is already pending/);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 5 claims per IP per hour, then 429', async () => {
    const world = new World();
    for (let i = 0; i < 5; i++) {
      expect((await world.post('/names/claim', await claimBody(`player-${i}`, newBadge()))).status).toBe(202);
    }
    const sixth = await world.post('/names/claim', await claimBody('player-5', newBadge()));
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/5 claims per hour/);
    expect(world.chain.sent).toHaveLength(5);
    const otherIp = await world.post('/names/claim', await claimBody('player-6', newBadge()), {
      'cf-connecting-ip': '198.51.100.1',
    });
    expect(otherIp.status).toBe(202);
  });

  it('allows 200 claims per day in total', async () => {
    const world = new World();
    await world.store.put('rate:claim:all', Array.from({ length: 200 }, () => NOW - 60));
    const res = await world.post('/names/claim', await claimBody('alice', newBadge()));
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/200 claims per day/);
    expect(world.chain.sent).toHaveLength(0);
  });
});
