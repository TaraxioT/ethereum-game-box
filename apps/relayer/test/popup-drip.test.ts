import { gameBoxNamesAbi } from '@egb/shared/names';
import { type Abi, parseEther } from 'viem';
import { describe, expect, it } from 'vitest';

import { CREATES_STORAGE_GAS } from '../src/request.ts';
import { newBadge } from './bodies.ts';
import { BOX_ACCOUNT, NOW, World, addresses } from './world.ts';

describe('POST /box/popup', () => {
  it('sends openPopup with the explicit gas limit', async () => {
    const world = new World();
    const res = await world.post('/box/popup', { label: 'stage' });
    expect(res.status).toBe(202);
    expect(world.chain.sent[0]).toMatchObject({ to: addresses.licences.toLowerCase(), gas: CREATES_STORAGE_GAS });
  });

  it('refuses a bad label', async () => {
    const world = new World();
    for (const label of ['', '-x', 'Stage', 'a'.repeat(27)]) {
      expect((await world.post('/box/popup', { label })).status).toBe(400);
    }
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses a pop-up that is still live', async () => {
    const world = new World();
    world.popups.set('popup-stage', BigInt(NOW + 60));
    const res = await world.post('/box/popup', { label: 'stage' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/popup-stage.gamebox.eth is live/);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('opens a lapsed pop-up again', async () => {
    const world = new World();
    world.popups.set('popup-stage', BigInt(NOW - 1));
    expect((await world.post('/box/popup', { label: 'stage' })).status).toBe(202);
  });

  it('passes an eth_call revert on by name', async () => {
    const world = new World();
    world.reverts.set('openPopup', [gameBoxNamesAbi as Abi, 'BoxNotLive', ['mumbai-01']]);
    const res = await world.post('/box/popup', { label: 'stage' });
    expect(res).toMatchObject({ status: 422, body: { revert: 'BoxNotLive' } });
    expect(world.chain.sent).toHaveLength(0);
  });

  it('allows 3 per IP per hour', async () => {
    const world = new World();
    for (const label of ['one', 'two', 'three']) expect((await world.post('/box/popup', { label })).status).toBe(202);
    const fourth = await world.post('/box/popup', { label: 'four' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/3 pop-ups per hour/);
    expect(world.chain.sent).toHaveLength(3);
  });

  it('allows 5 live at once', async () => {
    const world = new World();
    for (let i = 0; i < 5; i++) {
      const res = await world.post('/box/popup', { label: `p${i}x` }, { 'cf-connecting-ip': `198.51.100.${i}` });
      expect(res.status).toBe(202);
    }
    const sixth = await world.post('/box/popup', { label: 'p5x' }, { 'cf-connecting-ip': '198.51.100.9' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toMatch(/5 live pop-ups/);
    expect(world.chain.sent).toHaveLength(5);
  });
});

describe('POST /names/drip', () => {
  const player = () => {
    const world = new World();
    const badge = newBadge().address;
    world.players.set(badge.toLowerCase(), 'alice');
    return { world, badge };
  };

  it('sends 0.0003 ETH to a badge with a name and no gas', async () => {
    const { world, badge } = player();
    expect((await world.post('/names/drip', { badge })).status).toBe(202);
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]!.to).toBe(badge.toLowerCase());
  });

  it('refuses a badge without a player name', async () => {
    const world = new World();
    const res = await world.post('/names/drip', { badge: newBadge().address });
    expect(res.status).toBe(403);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses a contract account, which acts through /account/execute', async () => {
    const world = new World();
    world.players.set(BOX_ACCOUNT.toLowerCase(), 'robot');
    const res = await world.post('/names/drip', { badge: BOX_ACCOUNT });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/contract account needs no ETH/);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses a badge that already has the drip amount', async () => {
    const { world, badge } = player();
    world.chain.balances.set(badge.toLowerCase(), parseEther('0.0003'));
    expect((await world.post('/names/drip', { badge })).status).toBe(409);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('drips once per badge, for good', async () => {
    const { world, badge } = player();
    await world.post('/names/drip', { badge });
    world.chain.head += 5;
    await world.relay.poll();
    const again = await world.post('/names/drip', { badge });
    expect(again.status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 50 per day', async () => {
    const { world, badge } = player();
    await world.store.put('rate:drip:all', Array.from({ length: 50 }, () => NOW - 100));
    expect((await world.post('/names/drip', { badge })).status).toBe(429);
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses a malformed badge', async () => {
    const world = new World();
    expect((await world.post('/names/drip', { badge: BOX_ACCOUNT.slice(0, 20) })).status).toBe(400);
  });
});
