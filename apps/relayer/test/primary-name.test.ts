import { PRIMARY_NAME_VECTOR, defaultReverseRegistrarAbi, gameBoxNamesAbi, primaryNameDigest } from '@egb/shared/names';
import { type Abi, recoverMessageAddress } from 'viem';
import { describe, expect, it } from 'vitest';

import { claimBody, newBadge, primaryNameConsent } from './bodies.ts';
import { NOW, World, addresses } from './world.ts';

async function claimWithPrimaryName(world: World, options: Parameters<typeof primaryNameConsent>[2] = {}) {
  const badge = newBadge();
  const body = { ...(await claimBody('alice', badge)), primaryName: await primaryNameConsent('alice', badge, options) };
  return { badge, res: await world.post('/names/claim', body) };
}

describe('the claim with a primary name', () => {
  it('matches the vector the registrar checks', async () => {
    expect(primaryNameDigest(PRIMARY_NAME_VECTOR.message, PRIMARY_NAME_VECTOR.registrar)).toBe(PRIMARY_NAME_VECTOR.digest);
    const signer = await recoverMessageAddress({
      message: { raw: PRIMARY_NAME_VECTOR.raw },
      signature: PRIMARY_NAME_VECTOR.signature,
    });
    expect(signer).toBe(PRIMARY_NAME_VECTOR.message.badge);
  });

  it('sends the reverse-registrar call after the claim is in a block, under the same id', async () => {
    const world = new World();
    const { res } = await claimWithPrimaryName(world);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'sent', primaryName: { status: 'signed' } });
    expect(world.chain.sent).toHaveLength(1);

    world.chain.receipts.set(world.chain.sent[0]!.hash, { status: 'success', block: 101 });
    world.chain.head = 101;
    await world.relay.poll();
    expect(world.chain.sent).toHaveLength(2);
    expect(world.chain.sent[1]).toMatchObject({ to: addresses.reverseRegistrar, nonce: 1 });
    const id = res.body.id as string;
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({ status: 'in-block', primaryName: { status: 'sent' } });

    // The claim is confirmed, but the request waits for its last step.
    world.chain.head = 103;
    expect(await world.relay.poll()).toBe(true);
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({ status: 'in-block', primaryName: { status: 'sent' } });

    world.chain.receipts.set(world.chain.sent[1]!.hash, { status: 'success', block: 104 });
    world.chain.head = 105;
    expect(await world.relay.poll()).toBe(false);
    expect((await world.get(`/tx/${id}`)).body).toMatchObject({
      status: 'done',
      block: 101,
      primaryName: { status: 'done', block: 104 },
    });
  });

  it('never sends the primary name when the claim fails', async () => {
    const world = new World();
    const { res } = await claimWithPrimaryName(world);
    world.chain.receipts.set(world.chain.sent[0]!.hash, { status: 'reverted', block: 101 });
    world.reverts.set('claimPlayer', [gameBoxNamesAbi as Abi, 'BadgeHasName', [newBadge().address, 'x']]);
    await world.relay.poll();
    expect(world.chain.sent).toHaveLength(1);
    expect((await world.get(`/tx/${res.body.id as string}`)).body).toMatchObject({
      status: 'failed',
      revert: 'BadgeHasName',
      primaryName: { status: 'failed', error: 'not sent: the claim failed' },
    });
  });

  const refusals: [string, (world: World) => Parameters<typeof primaryNameConsent>[2], number, RegExp][] = [
    ['an expiry too close', () => ({ expiry: BigInt(NOW + 30) }), 400, /primaryName: expiry must be at least 60s away/],
    ['an expiry more than an hour away', () => ({ expiry: BigInt(NOW + 3601) }), 400, /at most 3600s/],
    ['the wrong signer', () => ({ signer: newBadge() }), 401, /primaryName: not signed by the badge/],
    [
      'an eth_call revert, passed on by name',
      (world) => {
        world.reverts.set('setNameForAddrWithSignature', [defaultReverseRegistrarAbi as Abi, 'InvalidSignature', []]);
        return {};
      },
      422,
      /primaryName: the call reverts with InvalidSignature/,
    ],
  ];

  for (const [what, options, status, reason] of refusals) {
    it(`refuses ${what}, and the claim with it, with no transaction`, async () => {
      const world = new World();
      const { res } = await claimWithPrimaryName(world, options(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a replayed primary name', async () => {
    const world = new World();
    const badge = newBadge();
    const primaryName = await primaryNameConsent('alice', badge);
    await world.post('/names/claim', { ...(await claimBody('alice', badge)), primaryName });
    const again = await world.post('/names/claim', {
      ...(await claimBody('alice', badge, { deadline: BigInt(NOW + 900) })),
      primaryName,
    });
    expect(again.status).toBe(409);
    expect(world.chain.sent).toHaveLength(1);
  });
});
