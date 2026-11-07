import { gameBoxLobbyAbi } from '@egb/shared/swap';
import { type Abi, decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { SLIPPAGE_BPS } from '../src/requests/buy.ts';
import { buyBody, newBadge } from './bodies.ts';
import { BOX, LOBBY, NOW, World, addresses, boxKey } from './world.ts';

const decoded = (world: World) => decodeFunctionData({ abi: gameBoxLobbyAbi, data: world.chain.sent[0]!.data! });

/** The request a row refuses: what it is, its body, and the status, error and revert it gets. */
type Row = [string, (world: World) => unknown, number, RegExp, string?];

describe('POST /swap/buy', () => {
  it('sends GameBoxLobby.buy with minGbxOut 2% under the simulated GBX', async () => {
    const world = new World();
    const body = buyBody(world, newBadge().address);
    const res = await world.post('/swap/buy', body);
    expect(res).toMatchObject({ status: 202, body: { kind: 'buy', status: 'sent' } });
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]).toMatchObject({ to: LOBBY });
    const { r, s, ...buy } = body;
    const minGbxOut = world.gbxOut - (world.gbxOut * SLIPPAGE_BPS) / 10_000n;
    expect(minGbxOut).toBe(97_755_000_000_000_000_000n);
    expect(decoded(world)).toMatchObject({ functionName: 'buy', args: [{ ...buy, minGbxOut }, r, s] });
  });

  it('sends a signed buy once', async () => {
    const world = new World();
    const body = buyBody(world, newBadge().address);
    expect((await world.post('/swap/buy', body)).status).toBe(202);
    expect((await world.post('/swap/buy', body)).status).toBeGreaterThanOrEqual(400);
    expect(world.chain.sent).toHaveLength(1);
  });

  const rows: Row[] = [
    ['a buy of zero', (w) => buyBody(w, newBadge().address, { usdcIn: 0n }), 400, /usdcIn/, 'BadAmount'],
    ['a buy over 100 USDC', (w) => buyBody(w, newBadge().address, { usdcIn: 100_000_001n }), 400, /usdcIn/, 'BadAmount'],
    ['a buy with no badge', (w) => ({ ...buyBody(w, newBadge().address), badge: undefined }), 400, /badge: expected/],
    ['a passed deadline', (w) => buyBody(w, newBadge().address, { deadline: BigInt(NOW) }), 400, /deadline/],
    ['a bad Box label', (w) => buyBody(w, newBadge().address, { box: 'Mumbai 01' }), 400, /box/],
    ['another key', (w) => buyBody(w, newBadge().address, { key: boxKey() }), 401, /./],
    ['a signature for another amount', (w) => ({ ...buyBody(w, newBadge().address), usdcIn: '20000000' }), 401, /./],
  ];
  for (const [what, body, status, reason, revert] of rows) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/swap/buy', body(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a buy the lobby would revert, naming its error', async () => {
    const world = new World();
    world.reverts.set('buy', [gameBoxLobbyAbi as Abi, 'DailyCapReached', [BOX, 1_000_000_000n]]);
    const res = await world.post('/swap/buy', buyBody(world, newBadge().address));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.revert).toBe('DailyCapReached');
    expect(world.chain.sent).toHaveLength(0);
  });

  it('refuses until the lobby is deployed', async () => {
    const world = new World();
    world.deps.ctx.addresses = { ...addresses, lobby: undefined };
    const res = await world.post('/swap/buy', buyBody(world, newBadge().address));
    expect(res).toMatchObject({ status: 404, body: { error: 'GameBoxLobby is not deployed yet' } });
  });

  it('allows 3 buys per badge per hour', async () => {
    const world = new World();
    const badge = newBadge().address;
    for (const nonce of [1n, 2n, 3n]) {
      expect((await world.post('/swap/buy', buyBody(world, badge, { nonce }))).status).toBe(202);
    }
    const fourth = await world.post('/swap/buy', buyBody(world, badge, { nonce: 4n }));
    expect(fourth).toMatchObject({ status: 429, body: { error: 'rate limit: 3 GBX buys per hour from one badge' } });
  });
});
