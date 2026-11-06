import {
  EXECUTE_VECTOR,
  type ExecuteRequest,
  P256_VECTOR_KEY,
  RESULT_VECTOR,
  SEAT_VECTOR,
  STAKE_VECTOR,
  executeBatchDigest,
  executeDigest,
  fullName,
  permissionedResolverAbi,
  resultDigest,
  stakeDigest,
  usdc,
} from '@egb/shared/names';
import { MemoryStore } from '@egb/relayer/test/memory-store';
import { accountSignatureProblem, p256Problem } from '@egb/relayer/verify';
import { type Address, type Hex, decodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { Box } from '../src/box.ts';
import type { BoxChain, BoxInfo } from '../src/chain.ts';
import type { Reply } from '../src/relayer.ts';
import { p256Signer } from '../src/signer.ts';

const NOW = 1_800_000_000;
const ACCOUNT: Address = '0x00000000000000000000000000000000000000B0';
const RESULTS: Address = '0x00000000000000000000000000000000000000a2';
const POT: Address = '0x00000000000000000000000000000000000000a8';
const RESOLVER: Address = '0x00000000000000000000000000000000000000C0';

const decode = (data: Hex) => decodeFunctionData({ abi: permissionedResolverAbi, data }).args as [Hex, string, string];

/** The `[key, value]` writes of a `POST /account/execute` body. */
const writes = (body: Record<string, unknown>) => {
  const calls = (body.calls ?? [body.call]) as { target: Address; data: Hex }[];
  return calls.map((call) => decode(call.data).slice(1));
};

function setup(options: { box?: Partial<BoxInfo>; game?: string; reply?: (path: string, body: unknown) => Reply } = {}) {
  const boxes: Record<string, BoxInfo> = {
    'demo-01': { account: ACCOUNT, resolver: RESOLVER, expiry: NOW + 86_400, status: 1, ...options.box },
  };
  const usedRounds = new Set<string>();
  const chain: BoxChain = {
    box: async (label) => boxes[label] ?? { account: `0x${'00'.repeat(20)}`, resolver: `0x${'00'.repeat(20)}`, expiry: 0, status: 0 },
    text: async () => options.game ?? '',
    roundTaken: async (box, round) => usedRounds.has(`${box}:${round}`),
    openCup: async () => null,
  };
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const store = new MemoryStore();
  const signer = p256Signer(P256_VECTOR_KEY.privateKey);
  let nonce = 100n;
  const make = () =>
    new Box({
      store,
      chain,
      signer,
      account: ACCOUNT,
      label: 'demo-01',
      defaultGame: 'quickdraw',
      results: RESULTS,
      pot: POT,
      relayer: {
        post: async (path, body) => {
          posts.push({ path, body: body as Record<string, unknown> });
          return options.reply?.(path, body) ?? { status: 202, body: { id: `id-${posts.length}` } };
        },
        get: async () => ({ status: 404, body: {} }),
      },
      now: () => NOW,
      nonce: () => nonce++,
    });
  return { box: make(), make, posts, usedRounds, store, signer };
}

describe('the signer', () => {
  it('has the vector key and makes signatures the contracts accept', () => {
    const signer = p256Signer(P256_VECTOR_KEY.privateKey);
    expect(signer.qx).toBe(P256_VECTOR_KEY.qx);
    expect(signer.qy).toBe(P256_VECTOR_KEY.qy);
    for (const vector of [EXECUTE_VECTOR, RESULT_VECTOR, STAKE_VECTOR, SEAT_VECTOR]) {
      const { r, s } = signer.sign(vector.digest);
      expect(p256Problem(vector.digest, r, s, signer.qx, signer.qy)).toBeNull();
      // RFC 6979 on both sides: the same signature the contracts' test made.
      expect({ r, s }).toEqual({ r: vector.r, s: vector.s });
    }
    expect(signer.raw(EXECUTE_VECTOR.digest)).toBe(EXECUTE_VECTOR.signature);
  });
});

describe('the heartbeat', () => {
  it("signs a P256Account.execute of lastSeen on mumbai-01's resolver, raw, over the right digest", async () => {
    const { box, posts, signer } = setup({ game: 'quickdraw' });
    expect(await box.heartbeat()).toEqual(['id-1']);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe('/account/execute');
    const body = posts[0]!.body as unknown as ExecuteRequest;
    expect(body).toMatchObject({ account: ACCOUNT, deadline: String(NOW + 600), call: { target: RESOLVER, value: '0' } });
    expect(decode(body.call!.data)).toEqual([toHex(packetToBytes(fullName('demo-01'))), 'lastSeen', String(NOW)]);
    const digest = executeDigest(
      { ...body.call!, value: 0n, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) },
      ACCOUNT,
    );
    expect(accountSignatureProblem(digest, body.signature, signer.qx, signer.qy)).toBeNull();
    expect((await box.view()).lastSeen).toBe(NOW);
  });

  it('batches game with lastSeen, under one signature, only where the record differs', async () => {
    const { box, posts, signer } = setup({ game: 'stockduel' });
    await box.heartbeat();
    expect(posts).toHaveLength(1);
    const body = posts[0]!.body as unknown as ExecuteRequest;
    expect(writes(posts[0]!.body)).toEqual([
      ['lastSeen', String(NOW)],
      ['game', 'quickdraw'],
    ]);
    const calls = body.calls!.map((call) => ({ ...call, value: 0n }));
    const digest = executeBatchDigest({ calls, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, ACCOUNT);
    expect(accountSignatureProblem(digest, body.signature, signer.qx, signer.qy)).toBeNull();
  });

  it('skips a Box whose licence has lapsed, or that another account runs', async () => {
    for (const box of [{ expiry: NOW - 1 }, { account: '0x00000000000000000000000000000000000000b1' as Address }]) {
      const { box: demo, posts } = setup({ box });
      expect(await demo.heartbeat()).toEqual([]);
      expect(posts).toHaveLength(0);
    }
  });

  it('uses a fresh nonce for every beat', async () => {
    const { box, posts } = setup();
    await box.heartbeat();
    await box.heartbeat();
    const nonces = posts.map((p) => p.body.nonce);
    expect(new Set(nonces).size).toBe(nonces.length);
  });
});

describe('POST /result', () => {
  const winner = '0x1111111111111111111111111111111111111111';
  const loser = '0x2222222222222222222222222222222222222222';
  const report = { box: 'demo-01', game: 'quickdraw', winner, loser, draw: false };

  it('signs a Result with the next round and returns the relayer id', async () => {
    const { box, posts, signer } = setup();
    const reply = await box.report(report, 'ip');
    expect(reply).toEqual({ status: 202, body: { id: 'id-1', round: 1 } });
    const body = posts[0]!.body as { result: Record<string, string>; r: Hex; s: Hex };
    expect(posts[0]!.path).toBe('/box/result');
    const result = {
      ...report,
      winner: body.result.winner as Address,
      loser: body.result.loser as Address,
      round: 1n,
      deadline: BigInt(body.result.deadline!),
    };
    expect(p256Problem(resultDigest(result, RESULTS), body.r, body.s, signer.qx, signer.qy)).toBeNull();
  });

  it('never repeats a round: in parallel, across restarts, and past rounds with a result or a pot on chain', async () => {
    const { box, make, usedRounds } = setup();
    const replies = await Promise.all([box.report(report, 'a'), box.report(report, 'b'), box.report(report, 'c')]);
    expect(replies.map((r) => r.body.round)).toEqual([1, 2, 3]);
    usedRounds.add('demo-01:4').add('demo-01:5');
    expect((await make().report(report, 'd')).body.round).toBe(6);
  });

  it('shows the game it reported in the next heartbeat', async () => {
    const { box, posts } = setup({ game: 'quickdraw' });
    await box.report({ ...report, game: 'stockduel' }, 'ip');
    await box.heartbeat();
    expect(writes(posts.at(-1)!.body).at(-1)).toEqual(['game', 'stockduel']);
  });

  it('refuses a malformed report, and a Box it does not run, without signing', async () => {
    const { box, posts } = setup();
    expect((await box.report({ ...report, game: 'Quick' }, 'ip')).status).toBe(400);
    expect((await box.report({ ...report, winner: '0x12' }, 'ip')).status).toBe(400);
    expect((await box.report({ ...report, draw: 'no' }, 'ip')).status).toBe(400);
    expect((await box.report(null, 'ip')).status).toBe(400);
    expect((await box.report({ ...report, box: 'elsewhere' }, 'ip')).status).toBe(403);
    expect(posts).toHaveLength(0);
  });

  it('allows 10 per IP per hour', async () => {
    const { box, posts } = setup();
    for (let i = 0; i < 10; i++) expect((await box.report(report, 'ip')).status).toBe(202);
    const eleventh = await box.report(report, 'ip');
    expect(eleventh.status).toBe(429);
    expect(posts).toHaveLength(10);
    expect((await box.report(report, 'other')).status).toBe(202);
  });

  it("passes the relayer's refusal on", async () => {
    const { box } = setup({ reply: () => ({ status: 422, body: { error: 'the call reverts with NotAPlayer', revert: 'NotAPlayer' } }) });
    expect(await box.report(report, 'ip')).toEqual({
      status: 422,
      body: { error: 'the call reverts with NotAPlayer', revert: 'NotAPlayer' },
    });
  });
});

describe('POST /stake', () => {
  const a = '0x1111111111111111111111111111111111111111';
  const b = '0x2222222222222222222222222222222222222222';
  const stake = { box: 'demo-01', game: 'stockduel', a, b, amount: '10000000' };

  it('signs a Stake with the next round and sends it to /duel/open', async () => {
    const { box, posts, signer } = setup();
    expect(await box.stake(stake, 'ip')).toEqual({ status: 202, body: { id: 'id-1', round: 1 } });
    expect(posts[0]!.path).toBe('/duel/open');
    const body = posts[0]!.body as { stake: Record<string, string>; r: Hex; s: Hex };
    expect(body.stake).toMatchObject({ box: 'demo-01', game: 'stockduel', round: '1', amount: '10000000', deadline: String(NOW + 600) });
    const signed = {
      box: 'demo-01',
      game: 'stockduel',
      round: 1n,
      a: body.stake.a as Address,
      b: body.stake.b as Address,
      amount: usdc(10),
      deadline: BigInt(NOW + 600),
    };
    expect(p256Problem(stakeDigest(signed, POT), body.r, body.s, signer.qx, signer.qy)).toBeNull();
  });

  it("settles a staked round with the result of the same round, once", async () => {
    const { box, posts } = setup();
    await box.stake(stake, 'ip');
    await box.report({ box: 'demo-01', game: 'quickdraw', winner: a, loser: b, draw: false }, 'ip');
    const reply = await box.report({ box: 'demo-01', game: 'stockduel', winner: a, loser: b, draw: false, round: '1' }, 'ip');
    expect(reply).toEqual({ status: 202, body: { id: 'id-3', round: 1 } });
    expect(posts.map((p) => [p.path, (p.body.result as { round?: string } | undefined)?.round])).toEqual([
      ['/duel/open', undefined],
      ['/box/result', '2'],
      ['/box/result', '1'],
    ]);
    const again = await box.report({ box: 'demo-01', game: 'stockduel', winner: a, loser: b, draw: false, round: 1 }, 'ip');
    expect(again).toEqual({ status: 409, body: { error: 'round 1 is not an open pot of demo-01.gamebox.eth' } });
    expect(posts).toHaveLength(3);
  });

  it('refuses a result for a round it never staked, without signing', async () => {
    const { box, posts } = setup();
    expect((await box.report({ box: 'demo-01', game: 'stockduel', winner: a, loser: b, draw: false, round: 7 }, 'ip')).status).toBe(409);
    expect((await box.report({ box: 'demo-01', game: 'stockduel', winner: a, loser: b, draw: false, round: 0 }, 'ip')).status).toBe(400);
    expect(posts).toHaveLength(0);
  });

  it("keeps the round when the relayer refuses the stake, and doesn't record a pot", async () => {
    const { box, posts } = setup({ reply: () => ({ status: 409, body: { error: 'kite.gamebox.eth holds 9 USDC, under the stake of 10' } }) });
    expect((await box.stake(stake, 'ip')).status).toBe(409);
    expect((await box.report({ box: 'demo-01', game: 'stockduel', winner: a, loser: b, draw: false, round: 1 }, 'ip')).status).toBe(409);
    expect(posts).toHaveLength(1);
  });

  it('refuses a malformed stake, a stake over 25 USDC, and a Box it does not run, without signing', async () => {
    const { box, posts } = setup();
    expect((await box.stake({ ...stake, amount: '25000001' }, 'ip')).body).toEqual({ error: 'amount: at most 25 USDC' });
    expect((await box.stake({ ...stake, amount: '0' }, 'ip')).status).toBe(400);
    expect((await box.stake({ ...stake, b: a }, 'ip')).status).toBe(400);
    expect((await box.stake({ ...stake, game: 'Stock Duel' }, 'ip')).status).toBe(400);
    expect((await box.stake(null, 'ip')).status).toBe(400);
    expect((await box.stake({ ...stake, box: 'mumbai-01' }, 'ip')).status).toBe(403);
    expect(posts).toHaveLength(0);
  });

  it('allows 10 per IP per hour', async () => {
    const { box, posts } = setup();
    for (let i = 0; i < 10; i++) expect((await box.stake(stake, 'ip')).status).toBe(202);
    expect((await box.stake(stake, 'ip')).status).toBe(429);
    expect(posts).toHaveLength(10);
  });
});
