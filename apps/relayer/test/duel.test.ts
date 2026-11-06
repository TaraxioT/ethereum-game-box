import { duelPotAbi, usdc } from '@egb/shared/names';
import { type Abi, keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { newBadge, stakeBody } from './bodies.ts';
import { BOX, NOW, World, addresses, boxKey } from './world.ts';

/** A world where two named players hold 100 USDC each. */
function players() {
  const world = new World();
  const a = newBadge().address;
  const b = newBadge().address;
  for (const [player, label] of [[a, 'nova'], [b, 'kite']] as const) {
    world.players.set(player.toLowerCase(), label);
    world.usdc.set(player.toLowerCase(), usdc(100));
  }
  return { world, a, b };
}

describe('POST /duel/open', () => {
  it('sends DuelPot.open for a stake the Box signed', async () => {
    const { world, a, b } = players();
    const res = await world.post('/duel/open', stakeBody(world, a, b));
    expect(res).toMatchObject({ status: 202, body: { kind: 'pot-open', status: 'sent' } });
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]!.to).toBe(addresses.pot);
  });

  const refusals: [string, (world: World, a: `0x${string}`, b: `0x${string}`) => unknown, number, RegExp, string?][] = [
    ['a bad game label', (world, a, b) => stakeBody(world, a, b, { game: 'Stock Duel' }), 400, /stake.game/],
    ['a and b the same player', (world, a) => stakeBody(world, a, a), 400, /same player/, 'SamePlayer'],
    ['a stake of zero', (world, a, b) => stakeBody(world, a, b, { amount: 0n }), 400, /stake of zero/, 'ZeroAmount'],
    ['an expired deadline', (world, a, b) => stakeBody(world, a, b, { deadline: BigInt(NOW) }), 400, /deadline/],
    ['a high s', (world, a, b) => stakeBody(world, a, b, { highS: true }), 401, /high s/],
    ['a stake signed by another key', (world, a, b) => stakeBody(world, a, b, { key: boxKey() }), 401, /not signed by the Box key/],
    ['an unknown Box', (world, a, b) => stakeBody(world, a, b, { box: 'nowhere' }), 403, /nowhere is not a Box/, 'UnknownBox'],
    [
      'a Box whose licence expired',
      (world, a, b) => {
        world.boxes.get(BOX)!.expiry = BigInt(NOW);
        return stakeBody(world, a, b);
      },
      403,
      /licence has expired/,
      'BoxExpired',
    ],
    [
      'a suspended Box',
      (world, a, b) => {
        world.boxes.get(BOX)!.status = 2;
        return stakeBody(world, a, b);
      },
      403,
      /not active/,
      'BoxNotActive',
    ],
    [
      'a round that already had a pot',
      (world, a, b) => {
        world.pots.set(`${BOX}:1`, { a, b, amount: usdc(10), opened: BigInt(NOW), state: 2, game: keccak256(toHex('stockduel')) });
        return stakeBody(world, a, b);
      },
      409,
      /already had a pot \(Settled\)/,
      'PotExists',
    ],
    [
      'a player with no name',
      (world, a) => stakeBody(world, a, newBadge().address),
      403,
      /holds no player name/,
      'NotAPlayer',
    ],
    [
      'a player without the stake',
      (world, a, b) => {
        world.usdc.set(b.toLowerCase(), usdc(9));
        return stakeBody(world, a, b);
      },
      409,
      /kite.gamebox.eth holds 9 USDC, under the stake of 10/,
    ],
    [
      'an eth_call revert, by name',
      (world, a, b) => {
        world.reverts.set('open', [duelPotAbi as Abi, 'InvalidSignature', []]);
        return stakeBody(world, a, b);
      },
      422,
      /reverts with InvalidSignature/,
      'InvalidSignature',
    ],
  ];

  for (const [what, body, status, reason, revert] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const { world, a, b } = players();
      const res = await world.post('/duel/open', body(world, a, b));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a replayed stake and sends it once', async () => {
    const { world, a, b } = players();
    const body = stakeBody(world, a, b);
    expect((await world.post('/duel/open', body)).status).toBe(202);
    expect((await world.post('/duel/open', body)).status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });
});

describe('POST /duel/refund', () => {
  const open = (world: World, a: `0x${string}`, b: `0x${string}`, opened: number, state = 1) =>
    world.pots.set(`${BOX}:4`, { a, b, amount: usdc(10), opened: BigInt(opened), state, game: keccak256(toHex('stockduel')) });

  it('refunds an open pot an hour after it opened', async () => {
    const { world, a, b } = players();
    open(world, a, b, NOW - 3600);
    const res = await world.post('/duel/refund', { box: BOX, round: 4 });
    expect(res).toMatchObject({ status: 202, body: { kind: 'pot-refund' } });
    expect(world.chain.sent[0]!.to).toBe(addresses.pot);
  });

  const refusals: [string, (world: World, a: `0x${string}`, b: `0x${string}`) => void, number, RegExp, string?][] = [
    ['a round with no pot', () => {}, 409, /no open pot \(None\)/, 'PotNotOpen'],
    ['a settled pot', (world, a, b) => open(world, a, b, NOW - 7200, 2), 409, /no open pot \(Settled\)/, 'PotNotOpen'],
    ['a pot opened less than an hour ago', (world, a, b) => open(world, a, b, NOW - 3599), 409, /refunded from 1800000001/, 'TooEarly'],
    [
      'an eth_call revert, by name',
      (world, a, b) => {
        open(world, a, b, NOW - 3600);
        world.reverts.set('refund', [duelPotAbi as Abi, 'TooEarly', [BigInt(NOW + 5)]]);
      },
      422,
      /reverts with TooEarly/,
      'TooEarly',
    ],
  ];

  for (const [what, setup, status, reason, revert] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const { world, a, b } = players();
      setup(world, a, b);
      const res = await world.post('/duel/refund', { box: BOX, round: 4 });
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a bad Box label', async () => {
    const world = new World();
    expect((await world.post('/duel/refund', { box: 'Mumbai 01', round: 4 })).status).toBe(400);
    expect(world.chain.calls.size).toBe(0);
  });

  it('refuses a second refund while the first is pending', async () => {
    const { world, a, b } = players();
    open(world, a, b, NOW - 3600);
    expect((await world.post('/duel/refund', { box: BOX, round: 4 })).status).toBe(202);
    const again = await world.post('/duel/refund', { box: BOX, round: 4 });
    expect(again).toMatchObject({ status: 409, body: { error: `a request for pot:${BOX}:4 is already pending` } });
    expect(world.chain.sent).toHaveLength(1);
  });
});
