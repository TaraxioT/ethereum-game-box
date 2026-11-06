import { boxSeatsAbi, championshipsAbi, gameBoxNamesAbi } from '@egb/shared/names';
import type { Abi, Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { CREATES_STORAGE_GAS } from '../src/request.ts';
import { newBadge, seatBody } from './bodies.ts';
import { BOX, NOW, World, addresses, boxKey } from './world.ts';

describe('POST /players/box-claim', () => {
  it('sends BoxSeats.claim for a seat the Box signed, with the explicit gas limit', async () => {
    const world = new World();
    const res = await world.post('/players/box-claim', seatBody(world, 'nova', newBadge().address));
    expect(res).toMatchObject({ status: 202, body: { kind: 'seat' } });
    expect(world.chain.sent[0]).toMatchObject({ to: addresses.seats, gas: CREATES_STORAGE_GAS });
  });

  const refusals: [string, (world: World, badge: Address) => unknown, number, RegExp, string?][] = [
    ['a bad label', (world, badge) => seatBody(world, 'No Va', badge), 400, /seat.label/],
    ['an expired deadline', (world, badge) => seatBody(world, 'nova', badge, { deadline: BigInt(NOW + 10) }), 400, /deadline/],
    ['a high s', (world, badge) => seatBody(world, 'nova', badge, { highS: true }), 401, /high s/],
    ['the wrong Box key', (world, badge) => seatBody(world, 'nova', badge, { key: boxKey() }), 401, /not signed by the Box key/],
    [
      'a suspended Box',
      (world, badge) => {
        world.boxes.get(BOX)!.status = 2;
        return seatBody(world, 'nova', badge);
      },
      403,
      /not active/,
      'BoxNotActive',
    ],
    [
      'a badge that already holds a name',
      (world, badge) => {
        world.players.set(badge.toLowerCase(), 'kite');
        return seatBody(world, 'nova', badge);
      },
      409,
      /already holds kite.gamebox.eth/,
      'BadgeHasName',
    ],
    [
      'a taken label',
      (world, badge) => {
        world.register('nova');
        return seatBody(world, 'nova', badge);
      },
      409,
      /nova.gamebox.eth is taken/,
      'LabelAlreadyRegistered',
    ],
    ["a Box's label", (world, badge) => seatBody(world, BOX, badge), 409, /is a Box name/, 'LabelHeldByBox'],
    [
      'an eth_call revert, by name',
      (world, badge) => {
        world.reverts.set('claim', [gameBoxNamesAbi as Abi, 'InvalidLabel', ['nova']]);
        return seatBody(world, 'nova', badge);
      },
      422,
      /reverts with InvalidLabel/,
      'InvalidLabel',
    ],
  ];

  for (const [what, body, status, reason, revert] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/players/box-claim', body(world, newBadge().address));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a replayed seat and sends it once', async () => {
    const world = new World();
    const body = seatBody(world, 'nova', newBadge().address);
    expect((await world.post('/players/box-claim', body)).status).toBe(202);
    expect((await world.post('/players/box-claim', body)).status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 200 a day', async () => {
    const world = new World();
    await world.store.put('rate:seat:all', Array.from({ length: 200 }, (_, i) => NOW - i));
    const res = await world.post('/players/box-claim', seatBody(world, 'nova', newBadge().address));
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 200 Box-vouched names per day' } });
    expect(world.chain.sent).toHaveLength(0);
  });

  it('names a refusal of BoxSeats by its error', async () => {
    const world = new World();
    world.reverts.set('claim', [boxSeatsAbi as Abi, 'BoxExpired', [BOX]]);
    const res = await world.post('/players/box-claim', seatBody(world, 'nova', newBadge().address));
    expect(res.body.revert).toBe('BoxExpired');
  });
});

describe('POST /cup/close', () => {
  const ZERO: Address = '0x0000000000000000000000000000000000000000';
  const openCup = (world: World, ends: number) => {
    world.openCups.set('stockduel', 1n);
    world.cups.set(1n, {
      game: 'stockduel',
      label: 'mumbai-cup',
      resolver: '0x00000000000000000000000000000000000000C1',
      opener: ZERO,
      ends: BigInt(ends),
      prize: 100_000_000n,
      closed: false,
      winner: ZERO,
    });
  };

  it('sends Championships.close once ends has passed, with the explicit gas limit', async () => {
    const world = new World();
    openCup(world, NOW);
    const res = await world.post('/cup/close', { game: 'stockduel' });
    expect(res).toMatchObject({ status: 202, body: { kind: 'cup-close' } });
    expect(world.chain.sent[0]).toMatchObject({ to: addresses.cups, gas: CREATES_STORAGE_GAS });
  });

  const refusals: [string, (world: World) => unknown, number, RegExp, string?][] = [
    ['a bad game label', () => ({ game: 'Stock Duel' }), 400, /game:/],
    ['a game with no open championship', () => ({ game: 'stockduel' }), 409, /no open championship/, 'NoOpenCup'],
    [
      'a championship that has not ended',
      (world) => {
        openCup(world, NOW + 1);
        return { game: 'stockduel' };
      },
      409,
      /mumbai-cup runs until 1800000001/,
      'NotOver',
    ],
    [
      'an eth_call revert, by name',
      (world) => {
        openCup(world, NOW - 60);
        world.reverts.set('close', [championshipsAbi as Abi, 'NotOver', [BigInt(NOW + 5)]]);
        return { game: 'stockduel' };
      },
      422,
      /reverts with NotOver/,
      'NotOver',
    ],
  ];

  for (const [what, body, status, reason, revert] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/cup/close', body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a second close while the first is pending', async () => {
    const world = new World();
    openCup(world, NOW - 60);
    expect((await world.post('/cup/close', { game: 'stockduel' })).status).toBe(202);
    expect((await world.post('/cup/close', { game: 'stockduel' })).status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });
});
