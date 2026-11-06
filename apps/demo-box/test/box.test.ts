import {
  EXECUTE_VECTOR,
  P256_VECTOR_KEY,
  RESULT_VECTOR,
  executeDigest,
  fullName,
  permissionedResolverAbi,
  resultDigest,
} from '@egb/shared/names';
import { MemoryStore } from '@egb/relayer/test/memory-store';
import { p256Problem } from '@egb/relayer/verify';
import { type Address, type Hex, decodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { Box, type Reply } from '../src/box.ts';
import type { BoxChain, BoxInfo } from '../src/chain.ts';
import { p256Signer } from '../src/signer.ts';

const NOW = 1_800_000_000;
const ACCOUNT: Address = '0x00000000000000000000000000000000000000B0';
const RESULTS: Address = '0x00000000000000000000000000000000000000a2';
const resolverOf = (label: string) => `0x${label.length.toString(16).padStart(40, 'c')}` as Address;

const decode = (data: Hex) => decodeFunctionData({ abi: permissionedResolverAbi, data }).args as [Hex, string, string];

function setup(options: { popups?: Record<string, Partial<BoxInfo>>; reply?: (path: string, body: unknown) => Reply } = {}) {
  const boxes: Record<string, BoxInfo> = {
    'mumbai-01': { account: ACCOUNT, resolver: resolverOf('mumbai-01'), expiry: NOW + 86_400, status: 1 },
  };
  for (const [label, info] of Object.entries(options.popups ?? {})) {
    boxes[label] = { account: ACCOUNT, resolver: resolverOf(label), expiry: NOW + 300, status: 1, ...info };
  }
  const usedRounds = new Set<string>();
  const chain: BoxChain = {
    box: async (label) => boxes[label] ?? { account: `0x${'00'.repeat(20)}`, resolver: `0x${'00'.repeat(20)}`, expiry: 0, status: 0 },
    roundUsed: async (box, round) => usedRounds.has(`${box}:${round}`),
    recentPopups: async () => Object.keys(options.popups ?? {}),
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
      label: 'mumbai-01',
      defaultGame: 'quickdraw',
      results: RESULTS,
      post: async (path, body) => {
        posts.push({ path, body: body as Record<string, unknown> });
        return options.reply?.(path, body) ?? { status: 202, body: { id: `id-${posts.length}` } };
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
    for (const vector of [EXECUTE_VECTOR, RESULT_VECTOR]) {
      const { r, s } = signer.sign(vector.digest);
      expect(p256Problem(vector.digest, r, s, signer.qx, signer.qy)).toBeNull();
      // RFC 6979 on both sides: the same signature the contracts' test made.
      expect({ r, s }).toEqual({ r: vector.r, s: vector.s });
    }
  });
});

describe('the heartbeat', () => {
  it("signs a BoxAccount.execute of lastSeen on mumbai-01's resolver, over the right digest", async () => {
    const { box, posts, signer } = setup();
    const ids = await box.heartbeat();
    expect(ids).toEqual(['id-1', 'id-2']);
    expect(posts).toHaveLength(2);
    const body = posts[0]!.body as Record<string, string>;
    expect(posts[0]!.path).toBe('/box/execute');
    expect(body).toMatchObject({ account: ACCOUNT, target: resolverOf('mumbai-01'), value: '0', deadline: String(NOW + 600) });
    expect(decode(body.data as Hex)).toEqual([toHex(packetToBytes(fullName('mumbai-01'))), 'lastSeen', String(NOW)]);
    const call = {
      target: body.target as Address,
      value: 0n,
      data: body.data as Hex,
      nonce: BigInt(body.nonce!),
      deadline: BigInt(body.deadline!),
    };
    expect(p256Problem(executeDigest(call, ACCOUNT), body.r as Hex, body.s as Hex, signer.qx, signer.qy)).toBeNull();
    expect((await box.view()).lastSeen).toBe(NOW);
  });

  it('writes game on the first beat and when it changes, lastSeen on every beat', async () => {
    const { box, posts } = setup();
    await box.heartbeat();
    await box.heartbeat();
    expect(posts.map((p) => decode(p.body.data as Hex).slice(1))).toEqual([
      ['lastSeen', String(NOW)],
      ['game', 'quickdraw'],
      ['lastSeen', String(NOW)],
    ]);
  });

  it('writes game again if the relayer refused it', async () => {
    let n = 0;
    const { box, posts } = setup({ reply: () => (++n === 2 ? { status: 502, body: { error: 'down' } } : { status: 202, body: { id: `id-${n}` } }) });
    await box.heartbeat();
    await box.heartbeat();
    expect(posts.map((p) => decode(p.body.data as Hex)[1])).toEqual(['lastSeen', 'game', 'lastSeen', 'game']);
  });

  it('beats on every live pop-up it runs, and skips the lapsed and the foreign ones', async () => {
    const { box, posts } = setup({
      popups: {
        'popup-live': {},
        'popup-gone': { expiry: NOW - 1 },
        'popup-other': { account: '0x00000000000000000000000000000000000000b1' },
      },
    });
    await box.heartbeat();
    expect([...new Set(posts.map((p) => p.body.target))]).toEqual([resolverOf('mumbai-01'), resolverOf('popup-live')]);
  });

  it('uses a fresh nonce for every write', async () => {
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
  const report = { box: 'mumbai-01', game: 'quickdraw', winner, loser, draw: false };

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

  it('never repeats a round: in parallel, across restarts, and past rounds already on chain', async () => {
    const { box, make, usedRounds } = setup();
    const replies = await Promise.all([box.report(report, 'a'), box.report(report, 'b'), box.report(report, 'c')]);
    expect(replies.map((r) => r.body.round)).toEqual([1, 2, 3]);
    usedRounds.add('mumbai-01:4').add('mumbai-01:5');
    expect((await make().report(report, 'd')).body.round).toBe(6);
  });

  it('shows the game it reported in the next heartbeat', async () => {
    const { box, posts } = setup();
    await box.heartbeat();
    await box.report({ ...report, game: 'stockduel' }, 'ip');
    await box.heartbeat();
    expect(decode(posts.at(-1)!.body.data as Hex).slice(1)).toEqual(['game', 'stockduel']);
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
