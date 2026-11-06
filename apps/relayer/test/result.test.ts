import { boxResultsAbi, duelPotAbi } from '@egb/shared/names';
import type { Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import { CREATES_STORAGE_GAS } from '../src/request.ts';
import { BOX, NOW, World, addresses, boxKey } from './world.ts';
import { newBadge, resultBody } from './bodies.ts';

describe('POST /box/result', () => {
  const winner = newBadge().address;
  const loser = newBadge().address;

  it('sends BoxResults.submit for a result the Box signed', async () => {
    const world = new World();
    const res = await world.post('/box/result', resultBody(world, winner, loser));
    expect(res.status).toBe(202);
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]!.to).toBe(addresses.results);
  });

  const refusals: [string, (world: World) => unknown, number, RegExp][] = [
    ['a high s', (world) => resultBody(world, winner, loser, { highS: true }), 401, /high s/],
    [
      'a result signed by another key',
      (world) => {
        const body = resultBody(world, winner, loser);
        return { ...body, ...boxKey().sign(`0x${'ab'.repeat(32)}`) };
      },
      401,
      /not signed by the Box key/,
    ],
    ['an unknown Box', (world) => resultBody(world, winner, loser, { box: 'nowhere' }), 403, /nowhere is not a Box/],
    [
      'a Box whose licence expired',
      (world) => {
        world.boxes.get(BOX)!.expiry = BigInt(NOW - 1);
        return resultBody(world, winner, loser);
      },
      403,
      /licence has expired/,
    ],
    [
      'a revoked Box',
      (world) => {
        world.boxes.get(BOX)!.status = 3;
        return resultBody(world, winner, loser);
      },
      403,
      /not active/,
    ],
    ['a bad game label', (world) => ({ ...resultBody(world, winner, loser), result: { ...resultBody(world, winner, loser).result, game: 'Quick Draw' } }), 400, /result.game/],
    [
      'a round that is already settled',
      (world) => {
        world.usedRounds.add(`${BOX}:1`);
        return resultBody(world, winner, loser);
      },
      409,
      /round 1 of mumbai-01 is already settled/,
    ],
    [
      "a result that doesn't match its round's pot, named from DuelPot's errors",
      (world) => {
        world.reverts.set('submit', [duelPotAbi as Abi, 'PotMismatch', [BOX, 1n]]);
        return resultBody(world, winner, loser, { game: 'stockduel' });
      },
      422,
      /reverts with PotMismatch/,
    ],
    [
      'an eth_call revert, passed on by name',
      (world) => {
        world.reverts.set('submit', [boxResultsAbi as Abi, 'NotAPlayer', [loser]]);
        return resultBody(world, winner, loser);
      },
      422,
      /reverts with NotAPlayer/,
    ],
  ];

  for (const [what, body, status, reason] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/box/result', body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('gives a result that scores a championship the state-gas reservoir', async () => {
    const world = new World();
    // Over the 3M score cap, as a v3 result's estimate is.
    world.chain.estimate = 3_400_000n;
    await world.post('/box/result', resultBody(world, winner, loser, { game: 'stockduel' }));
    expect(world.chain.sent[0]!.gas).toBe(CREATES_STORAGE_GAS);
  });

  it("answers GET /tx/:id with the result's transaction hash", async () => {
    const world = new World();
    const { body } = await world.post('/box/result', resultBody(world, winner, loser));
    const hash = world.chain.sent[0]!.hash;
    expect((await world.get(`/tx/${body.id as string}`)).body).toMatchObject({
      kind: 'result',
      status: 'sent',
      hash,
      etherscan: `https://sepolia.etherscan.io/tx/${hash}`,
    });
  });

  it('refuses a replayed result and sends it once', async () => {
    const world = new World();
    const body = resultBody(world, winner, loser);
    await world.post('/box/result', body);
    const again = await world.post('/box/result', body);
    expect(again.status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });
});
