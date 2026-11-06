import { fakeUsdcAbi, usdc } from '@egb/shared/names';
import { type Abi, decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { newBadge } from './bodies.ts';
import { NOW, World, addresses } from './world.ts';

describe('POST /usdc/topup', () => {
  it('mints 100 USDC to a player, whatever it already holds', async () => {
    const world = new World();
    const player = newBadge().address;
    world.usdc.set(player.toLowerCase(), usdc(265));
    const res = await world.post('/usdc/topup', { player });
    expect(res).toMatchObject({ status: 202, body: { kind: 'topup', status: 'sent' } });
    expect(world.chain.sent).toHaveLength(1);
    const sent = world.chain.sent[0]!;
    expect(sent.to).toBe(addresses.usdc);
    expect(decodeFunctionData({ abi: fakeUsdcAbi, data: sent.data! })).toMatchObject({
      functionName: 'mint',
      args: [player, usdc(100)],
    });
  });

  it('takes an ENS name, resolved through the Universal Resolver', async () => {
    const world = new World();
    const player = newBadge().address;
    world.ensNames.set('nova.gamebox.eth', player);
    expect((await world.post('/usdc/topup', { player: 'Nova.gamebox.eth' })).status).toBe(202);
    expect(decodeFunctionData({ abi: fakeUsdcAbi, data: world.chain.sent[0]!.data! }).args?.[0]).toBe(player);
  });

  const refusals: [string, (world: World) => unknown, number, RegExp, string?][] = [
    ['a body with no player', () => ({}), 400, /player: expected a string/],
    ['something that is neither an address nor a name', () => ({ player: 'not a name' }), 400, /address or an ENS name/],
    ['a name that does not resolve', () => ({ player: 'nobody.gamebox.eth' }), 404, /does not resolve/],
    [
      'an eth_call revert (the relayer lost its minter role), by name',
      (world) => {
        world.reverts.set('mint', [fakeUsdcAbi as Abi, 'AccessControlUnauthorizedAccount', [world.relayerAccount.address, `0x${'00'.repeat(32)}`]]);
        return { player: newBadge().address };
      },
      422,
      /reverts with AccessControlUnauthorizedAccount/,
      'AccessControlUnauthorizedAccount',
    ],
  ];

  for (const [what, body, status, reason, revert] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/usdc/topup', body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('allows one top-up per player per 10 minutes', async () => {
    const world = new World();
    const player = newBadge().address;
    expect((await world.post('/usdc/topup', { player })).status).toBe(202);
    world.chain.head++;
    world.chain.receipts.set(world.chain.sent[0]!.hash, { status: 'success', block: 100 });
    await world.relay.poll();
    const again = await world.post('/usdc/topup', { player });
    expect(again).toMatchObject({ status: 429, body: { error: 'rate limit: one top-up per player per 10 minutes' } });
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 60 top-ups a day from one address, apart from /store/topup', async () => {
    const world = new World();
    await world.store.put('rate:topup:ip:203.0.113.7', Array.from({ length: 60 }, (_, i) => NOW - i));
    const res = await world.post('/usdc/topup', { player: newBadge().address });
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 60 top-ups per day from one address' } });
    expect(world.chain.sent).toHaveLength(0);
    expect((await world.post('/store/topup', { player: newBadge().address })).status).toBe(202);
  });

  it('allows 300 top-ups a day in all', async () => {
    const world = new World();
    await world.store.put('rate:topup:all', Array.from({ length: 300 }, (_, i) => NOW - i));
    const res = await world.post('/usdc/topup', { player: newBadge().address });
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 300 top-ups per day' } });
    expect(world.chain.sent).toHaveLength(0);
  });
});
