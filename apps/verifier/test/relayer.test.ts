// Where the verifier meets the relayer. Every other test here stands in a fake relayer that takes any body, so this one
// puts the exact bytes the real `Judge` sends through the relayer's real routes, its checks and the fake chain behind them.

import { World as RelayerWorld } from '@egb/relayer/test/world';
import { storePotAbi } from '@egb/shared/store';
import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { AMOUNT, BOX, NOW, PLAYERS, POT, ROUND, stakedWorld } from './world.ts';

type Staked = Awaited<ReturnType<typeof stakedWorld>>;

/** The relayer's side of `world`'s pot: open, on the same terms, with `world`'s key holding `VERIFIER_ROLE`. */
function relayerFor(world: Staked): RelayerWorld {
  const relayer = new RelayerWorld();
  relayer.verifiers.add(world.signer.address.toLowerCase());
  relayer.storePots.set(`${BOX}:${ROUND}`, {
    players: [...PLAYERS],
    amount: BigInt(AMOUNT),
    opened: BigInt(NOW - 60),
    state: 1,
    bundle: world.pot.bundle,
    record: `0x${'00'.repeat(32)}`,
  });
  return relayer;
}

/** Judges `world`'s match, and answers what the Worker sent as it left: `payRelayer` sends plain JSON. */
async function judged(world: Staked) {
  await world.post(world.deps(), world.signedRequest(world.log));
  await world.settle(world.current());
  const [sent] = world.relayer.sends;
  if (!sent) throw new Error('the Worker sent nothing');
  return { path: sent.path, body: JSON.parse(JSON.stringify(sent.body)) as unknown };
}

const decoded = (relayer: RelayerWorld) => {
  const [tx] = relayer.chain.sent;
  if (!tx?.data) throw new Error('nothing reached the chain');
  expect(tx.to).toBe(POT);
  return decodeFunctionData({ abi: storePotAbi, data: tx.data });
};

describe('what the Worker sends the relayer', () => {
  it('pays a verdict: the relayer takes it, and the chain gets the split', async () => {
    const world = await stakedWorld();
    const { path, body } = await judged(world);
    expect(path).toBe('/store/settle');

    const relayer = relayerFor(world);
    expect(await relayer.post(path, body)).toMatchObject({ status: 202, body: { kind: 'store-settle', status: 'sent' } });
    const { functionName, args } = decoded(relayer);
    expect(functionName).toBe('settle');
    expect(args?.[0]).toMatchObject({ box: BOX, round: BigInt(ROUND), payouts: [10_000_000n, 0n] });
  });

  it('voids a match the agent could not judge: the relayer takes it, and the chain gets the void', async () => {
    const world = await stakedWorld();
    world.zg.settings.payouts = null;
    const { path, body } = await judged(world);
    expect(path).toBe('/store/void');

    const relayer = relayerFor(world);
    expect(await relayer.post(path, body)).toMatchObject({ status: 202, body: { kind: 'store-void', status: 'sent' } });
    const { functionName, args } = decoded(relayer);
    expect(functionName).toBe('voidPot');
    expect(args?.[0]).toMatchObject({ box: BOX, round: BigInt(ROUND) });
  });

  it('is refused if its key has lost the role, before any gas', async () => {
    const world = await stakedWorld();
    const { path, body } = await judged(world);

    const relayer = relayerFor(world);
    relayer.verifiers.clear();
    expect(await relayer.post(path, body)).toMatchObject({ status: 403, body: { revert: 'NotVerifier' } });
    expect(relayer.chain.sent).toHaveLength(0);
  });
});
