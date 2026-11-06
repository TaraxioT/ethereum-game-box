import { boxAccountAbi, boxResultsAbi, fullName, permissionedResolverAbi } from '@egb/shared/names';
import { type Abi, encodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { BOX, BOX_ACCOUNT, NOW, World, addresses, boxKey } from './world.ts';
import { executeBody, newBadge, resultBody, setTextData } from './bodies.ts';

describe('POST /box/execute', () => {
  it('sends BoxAccount.execute for a Box writing its own lastSeen', async () => {
    const world = new World();
    const res = await world.post('/box/execute', executeBody(world));
    expect(res.status).toBe(202);
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]!.to).toBe(BOX_ACCOUNT.toLowerCase());
    expect(world.chain.sent[0]!.gas).toBe(300_000n);
  });

  it('takes the game key too', async () => {
    const world = new World();
    expect((await world.post('/box/execute', executeBody(world, { data: setTextData('game', 'quickdraw') }))).status).toBe(202);
  });

  const refusals: [string, (world: World) => unknown, number, RegExp][] = [
    ['a high s', (world) => executeBody(world, { highS: true }), 401, /high s/],
    ['a signature by another key', (world) => executeBody(world, { sign: boxKey() }), 401, /not signed by the Box key/],
    [
      'a selector outside the allowlist',
      (world) =>
        executeBody(world, {
          data: encodeFunctionData({
            abi: permissionedResolverAbi,
            functionName: 'setAddress',
            args: [toHex(packetToBytes(fullName(BOX))), 60n, BOX_ACCOUNT],
          }),
        }),
      403,
      /setAddress is not on the allowlist/,
    ],
    ['unknown calldata', (world) => executeBody(world, { data: '0xdeadbeef' }), 403, /selector is not on the allowlist/],
    ['a key outside the allowlist', (world) => executeBody(world, { data: setTextData('status', 'active') }), 403, /key "status"/],
    [
      'another target',
      (world) => executeBody(world, { target: '0x00000000000000000000000000000000000000c1' }),
      403,
      /target is not the resolver/,
    ],
    [
      'an account that is not the Box',
      (world) => executeBody(world, { account: '0x00000000000000000000000000000000000000b1' }),
      403,
      /not the BoxAccount/,
    ],
    ['a name that is not a Box', (world) => executeBody(world, { data: setTextData('lastSeen', '1', 'alice') }), 403, /alice.gamebox.eth is not a Box/],
    ['a value', (world) => executeBody(world, { value: 1n }), 403, /value must be 0/],
    [
      'an expired deadline',
      (world) => ({ ...executeBody(world), deadline: String(NOW - 5) }),
      400,
      /deadline/,
    ],
    [
      'an eth_call revert, passed on by name',
      (world) => {
        world.reverts.set('execute', [boxAccountAbi as Abi, 'NonceUsed', [7n]]);
        return executeBody(world);
      },
      422,
      /reverts with NonceUsed/,
    ],
  ];

  for (const [what, body, status, reason] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/box/execute', body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses an expired licence', async () => {
    const world = new World();
    world.boxes.get(BOX)!.expiry = BigInt(NOW);
    const res = await world.post('/box/execute', executeBody(world));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/licence has expired/);
  });

  it('refuses a replayed execute and sends it once', async () => {
    const world = new World();
    const body = executeBody(world);
    expect((await world.post('/box/execute', body)).status).toBe(202);
    const again = await world.post('/box/execute', body);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/replay/);
    expect(world.chain.sent).toHaveLength(1);
  });
});

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

  it('refuses a replayed result and sends it once', async () => {
    const world = new World();
    const body = resultBody(world, winner, loser);
    await world.post('/box/result', body);
    const again = await world.post('/box/result', body);
    expect(again.status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });
});
