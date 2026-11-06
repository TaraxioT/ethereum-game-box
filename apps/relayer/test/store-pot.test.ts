import { fakeUsdcAbi, storePotAbi, usdc } from '@egb/shared/names';
import { type Abi, type Address, decodeFunctionData, getAddress, keccak256, toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { BUNDLE, highSignature, newBadge, storeStakeBody, verdictBody, voidBody } from './bodies.ts';
import { Revert, nodeRevert } from './fake-chain.ts';
import { BOX, NOW, STORE_POT, STORE_USDC, type StorePotEntry, World, addresses, boxKey } from './world.ts';

/** A world with `count` players holding 100 Store USDC each, `BUNDLE` listed, and a key with `VERIFIER_ROLE`. */
function match(count = 2) {
  const world = new World();
  const players = Array.from({ length: count }, () => newBadge().address);
  for (const player of players) world.storeUsdc.set(player.toLowerCase(), usdc(100));
  world.listed.add(BUNDLE);
  const verifier = newBadge();
  world.verifiers.add(verifier.address.toLowerCase());
  return { world, players, verifier };
}
type Match = ReturnType<typeof match>;

/** Puts a pot of 10 USDC each in round 1, opened a minute ago, unless `entry` says otherwise. */
function withPot({ world, players }: Match, entry: Partial<StorePotEntry> = {}) {
  world.storePots.set(`${BOX}:1`, {
    players,
    amount: usdc(10),
    opened: BigInt(NOW - 60),
    state: 1,
    bundle: BUNDLE,
    record: `0x${'00'.repeat(32)}`,
    ...entry,
  });
}

/** The request a row refuses: what it is, its body, and the status, error and revert it gets. */
type Row = [string, (m: Match) => unknown, number, RegExp, string?];

/** A test for each row: the refusal, and no gas spent on it. */
function refuses(path: string, rows: Row[], setup: (m: Match) => void = () => {}) {
  for (const [what, body, status, reason, revert] of rows) {
    it(`refuses ${what} with no transaction`, async () => {
      const m = match();
      setup(m);
      const res = await m.world.post(path, await body(m));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      if (revert) expect(res.body.revert).toBe(revert);
      expect(m.world.chain.sent).toHaveLength(0);
      expect(m.world.chain.calls.get('eth_estimateGas')).toBeUndefined();
    });
  }
}

const ZERO_SPLIT = [usdc(20), 0n];
const decoded = (world: World, i = 0) => decodeFunctionData({ abi: storePotAbi, data: world.chain.sent[i]!.data! });

describe('POST /store/open', () => {
  for (const count of [2, 3, 4]) {
    it(`sends StorePot.open for ${count} players the Box vouched for`, async () => {
      const { world, players } = match(count);
      const body = storeStakeBody(world, players);
      const res = await world.post('/store/open', body);
      expect(res).toMatchObject({ status: 202, body: { kind: 'store-open', status: 'sent' } });
      expect(world.chain.sent).toHaveLength(1);
      expect(world.chain.sent[0]).toMatchObject({ to: STORE_POT, gas: 300_000n });
      expect(decoded(world)).toMatchObject({ functionName: 'open', args: [{ ...body.stake, players }, body.r, body.s] });
    });
  }

  it('takes a player who holds exactly the stake', async () => {
    const { world, players } = match();
    world.storeUsdc.set(players[1]!.toLowerCase(), usdc(10));
    expect((await world.post('/store/open', storeStakeBody(world, players))).status).toBe(202);
  });

  const without = (m: Match, name: string) => {
    const { stake, ...signature } = storeStakeBody(m.world, m.players);
    return { ...signature, stake: { ...stake, [name]: undefined } };
  };
  const stakeWith = (m: Match, fields: Record<string, unknown>) => {
    const { stake, ...signature } = storeStakeBody(m.world, m.players);
    return { ...signature, stake: { ...stake, ...fields } };
  };

  refuses('/store/open', [
    ['a body with no stake', () => ({}), 400, /stake: expected an object/],
    ['a stake with no box', (m) => without(m, 'box'), 400, /stake.box: expected a string/],
    ['a stake with no bundle', (m) => without(m, 'bundle'), 400, /stake.bundle: expected 0x-hex bytes/],
    ['a bundle hash of the wrong size', (m) => stakeWith(m, { bundle: '0x1234' }), 400, /stake.bundle: expected 32 bytes/],
    ['a stake with no round', (m) => without(m, 'round'), 400, /stake.round: expected an unsigned integer/],
    ['a stake with no amount', (m) => without(m, 'amount'), 400, /stake.amount: expected an unsigned integer/],
    ['a stake with no deadline', (m) => without(m, 'deadline'), 400, /stake.deadline: expected an unsigned integer/],
    ['a stake with no players', (m) => without(m, 'players'), 400, /stake.players: expected 2 to 4 items/, 'PlayerCount'],
    ['one player', (m) => storeStakeBody(m.world, m.players.slice(0, 1)), 400, /stake.players: expected 2 to 4/, 'PlayerCount'],
    [
      'five players',
      (m) => storeStakeBody(m.world, Array.from({ length: 5 }, () => newBadge().address)),
      400,
      /stake.players: expected 2 to 4/,
      'PlayerCount',
    ],
    ['a player that is no address', (m) => stakeWith(m, { players: [m.players[0], 'nova'] }), 400, /stake.players.1: expected an address/],
    [
      'a repeated player',
      (m) => storeStakeBody(m.world, [m.players[0]!, m.players[1]!, m.players[0]!]),
      400,
      /is there twice/,
      'RepeatedPlayer',
    ],
    [
      'a repeated player in another case',
      (m) => storeStakeBody(m.world, [m.players[0]!, m.players[0]!.toLowerCase() as Address]),
      400,
      /is there twice/,
      'RepeatedPlayer',
    ],
    ['StorePot as a player', (m) => storeStakeBody(m.world, [m.players[0]!, STORE_POT]), 400, /StorePot can not be a player/, 'PotIsPlayer'],
    ['a stake of zero', (m) => storeStakeBody(m.world, m.players, { amount: 0n }), 400, /stake of zero/, 'ZeroAmount'],
    ['a bad Box label', (m) => storeStakeBody(m.world, m.players, { box: 'Mumbai 01' }), 400, /stake.box/],
    ['a signature with no r', (m) => ({ ...storeStakeBody(m.world, m.players), r: undefined }), 400, /r: expected 0x-hex bytes/],
    ['a signature with no s', (m) => ({ ...storeStakeBody(m.world, m.players), s: undefined }), 400, /s: expected 0x-hex bytes/],
    ['an expired deadline', (m) => storeStakeBody(m.world, m.players, { deadline: BigInt(NOW) }), 400, /deadline/],
    ['a high s', (m) => storeStakeBody(m.world, m.players, { highS: true }), 401, /high s/],
    ['a stake signed by another key', (m) => storeStakeBody(m.world, m.players, { key: boxKey() }), 401, /not signed by the Box key/],
    ['a stake changed after signing', (m) => stakeWith(m, { amount: usdc(11) }), 401, /not signed by the Box key/],
    ['an unknown Box', (m) => storeStakeBody(m.world, m.players, { box: 'nowhere' }), 403, /nowhere is not a Box/, 'UnknownBox'],
    [
      'a Box whose licence expired',
      (m) => {
        m.world.boxes.get(BOX)!.expiry = BigInt(NOW);
        return storeStakeBody(m.world, m.players);
      },
      403,
      /licence has expired/,
      'BoxExpired',
    ],
    [
      'a suspended Box',
      (m) => {
        m.world.boxes.get(BOX)!.status = 2;
        return storeStakeBody(m.world, m.players);
      },
      403,
      /not active/,
      'BoxNotActive',
    ],
    [
      'a bundle that is not listed',
      (m) => storeStakeBody(m.world, m.players, { bundle: keccak256(toHex('another game')) }),
      403,
      /is not listed/,
      'NotListed',
    ],
    [
      'a round that already had a pot',
      (m) => {
        withPot(m, { state: 3 });
        return storeStakeBody(m.world, m.players);
      },
      409,
      /already had a pot \(Voided\)/,
      'PotExists',
    ],
    [
      'a player short of Store USDC',
      (m) => {
        m.world.storeUsdc.set(m.players[1]!.toLowerCase(), usdc(9));
        return storeStakeBody(m.world, m.players);
      },
      409,
      /holds 9 USDC, under the stake of 10/,
    ],
    [
      'a player whose USDC is the other token',
      (m) => {
        m.world.storeUsdc.delete(m.players[0]!.toLowerCase());
        m.world.usdc.set(m.players[0]!.toLowerCase(), usdc(100));
        return storeStakeBody(m.world, m.players);
      },
      409,
      /holds 0 USDC/,
    ],
    [
      'an eth_call revert, by name',
      (m) => {
        m.world.reverts.set('open', [storePotAbi as Abi, 'PotExists', [BOX, 1n]]);
        return storeStakeBody(m.world, m.players);
      },
      422,
      /reverts with PotExists/,
      'PotExists',
    ],
  ]);

  it('refuses a replayed stake and sends it once', async () => {
    const { world, players } = match();
    const body = storeStakeBody(world, players);
    expect((await world.post('/store/open', body)).status).toBe(202);
    const again = await world.post('/store/open', body);
    expect(again).toMatchObject({ status: 409, body: { error: 'already sent: this signed request is a replay' } });
    expect(world.chain.sent).toHaveLength(1);
  });

  it('refuses a second stake of the round while the first is pending', async () => {
    const { world, players } = match();
    expect((await world.post('/store/open', storeStakeBody(world, players))).status).toBe(202);
    const again = await world.post('/store/open', storeStakeBody(world, players, { deadline: BigInt(NOW + 700) }));
    expect(again).toMatchObject({ status: 409, body: { error: `a request for pot:${BOX}:1 is already pending` } });
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows one Box 30 pots an hour, and no more of the wallet', async () => {
    const { world, players } = match();
    for (let round = 1n; round <= 30n; round++) {
      expect((await world.post('/store/open', storeStakeBody(world, players, { round }))).status).toBe(202);
    }
    const res = await world.post('/store/open', storeStakeBody(world, players, { round: 31n }));
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 30 store pots per hour from one Box' } });
    expect(world.chain.sent).toHaveLength(30);
  });

  it('counts each Box apart', async () => {
    const { world, players } = match();
    await world.store.put(`rate:store-open:box:${BOX}`, Array.from({ length: 30 }, (_, i) => NOW - i));
    world.boxes.set('delhi-01', world.boxes.get(BOX)!);
    expect((await world.post('/store/open', storeStakeBody(world, players, { box: 'delhi-01' }))).status).toBe(202);
    expect((await world.post('/store/open', storeStakeBody(world, players))).status).toBe(429);
  });

  it('counts only a stake the Box signed, so nobody else can use up its hour', async () => {
    const { world, players } = match();
    await world.store.put(`rate:store-open:box:${BOX}`, Array.from({ length: 29 }, (_, i) => NOW - i));
    expect((await world.post('/store/open', storeStakeBody(world, players, { key: boxKey() }))).status).toBe(401);
    expect((await world.post('/store/open', storeStakeBody(world, players))).status).toBe(202);
  });
});

describe('POST /store/settle', () => {
  for (const [count, payouts] of [
    [2, [usdc(15), usdc(5)]],
    [3, [usdc(30), 0n, 0n]],
    [4, [usdc(25), 0n, usdc(14), usdc(1)]],
  ] as const) {
    it(`sends StorePot.settle for a verifier's split between ${count} players`, async () => {
      const m = match(count);
      withPot(m);
      const body = await verdictBody(m.verifier, [...payouts]);
      const res = await m.world.post('/store/settle', body);
      expect(res).toMatchObject({ status: 202, body: { kind: 'store-settle', status: 'sent' } });
      expect(m.world.chain.sent).toHaveLength(1);
      expect(m.world.chain.sent[0]).toMatchObject({ to: STORE_POT, gas: 300_000n });
      expect(decoded(m.world)).toMatchObject({ functionName: 'settle', args: [body.verdict, body.signature] });
    });
  }

  it('still settles a pot past the refund delay', async () => {
    const m = match();
    withPot(m, { opened: BigInt(NOW - 7200) });
    expect((await m.world.post('/store/settle', await verdictBody(m.verifier, ZERO_SPLIT))).status).toBe(202);
  });

  const verdictWith = async (m: Match, fields: Record<string, unknown>) => {
    const { verdict, signature } = await verdictBody(m.verifier, ZERO_SPLIT);
    return { signature, verdict: { ...verdict, ...fields } };
  };

  refuses(
    '/store/settle',
    [
      ['a body with no verdict', () => ({}), 400, /verdict: expected an object/],
      ['a verdict with no box', (m) => verdictWith(m, { box: undefined }), 400, /verdict.box: expected a string/],
      ['a verdict with no round', (m) => verdictWith(m, { round: undefined }), 400, /verdict.round: expected an unsigned integer/],
      ['a verdict with no record', (m) => verdictWith(m, { record: undefined }), 400, /verdict.record: expected 0x-hex bytes/],
      ['a record of the wrong size', (m) => verdictWith(m, { record: '0x12' }), 400, /verdict.record: expected 32 bytes/],
      ['a verdict with no deadline', (m) => verdictWith(m, { deadline: undefined }), 400, /verdict.deadline: expected an unsigned integer/],
      ['a verdict with no payouts', (m) => verdictWith(m, { payouts: undefined }), 400, /verdict.payouts: expected 2 to 4/, 'PayoutCount'],
      ['one payout', (m) => verdictBody(m.verifier, [usdc(20)]), 400, /verdict.payouts: expected 2 to 4/, 'PayoutCount'],
      ['five payouts', (m) => verdictBody(m.verifier, [usdc(20), 0n, 0n, 0n, 0n]), 400, /verdict.payouts: expected 2 to 4/, 'PayoutCount'],
      ['a payout that is no number', (m) => verdictWith(m, { payouts: ['ten', 0] }), 400, /verdict.payouts.0: expected an unsigned integer/],
      ['a negative payout', (m) => verdictWith(m, { payouts: [usdc(20), -1] }), 400, /verdict.payouts.1: expected an unsigned integer/],
      ['a bad Box label', (m) => verdictBody(m.verifier, ZERO_SPLIT, { box: 'Mumbai 01' }), 400, /verdict.box/],
      ['a verdict with no signature', async (m) => ({ ...(await verdictBody(m.verifier, ZERO_SPLIT)), signature: undefined }), 400, /signature: expected 0x-hex bytes/],
      ['an expired deadline', (m) => verdictBody(m.verifier, ZERO_SPLIT, { deadline: BigInt(NOW) }), 400, /deadline/],
      [
        'a signature of 64 bytes',
        async (m) => {
          const body = await verdictBody(m.verifier, ZERO_SPLIT);
          return { ...body, signature: body.signature.slice(0, 130) };
        },
        401,
        /65 bytes/,
        'ECDSAInvalidSignatureLength',
      ],
      [
        'a high s',
        async (m) => {
          const body = await verdictBody(m.verifier, ZERO_SPLIT);
          return { ...body, signature: highSignature(body.signature) };
        },
        401,
        /high s/,
        'ECDSAInvalidSignatureS',
      ],
      [
        'a v that is neither 27 nor 28',
        async (m) => {
          const body = await verdictBody(m.verifier, ZERO_SPLIT);
          return { ...body, signature: `${body.signature.slice(0, 130)}00` };
        },
        401,
        /not a valid signature/,
        'ECDSAInvalidSignature',
      ],
      ['a signer without VERIFIER_ROLE', () => verdictBody(newBadge(), ZERO_SPLIT), 403, /does not hold VERIFIER_ROLE/, 'NotVerifier'],
      [
        'a verifier whose role was revoked',
        (m) => {
          m.world.verifiers.clear();
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        403,
        /does not hold VERIFIER_ROLE/,
        'NotVerifier',
      ],
      ['a verdict changed after signing', (m) => verdictWith(m, { payouts: [0n, usdc(20)] }), 403, /does not hold VERIFIER_ROLE/, 'NotVerifier'],
      [
        "a void's signature on a verdict",
        async (m) => ({
          verdict: (await verdictBody(m.verifier, ZERO_SPLIT)).verdict,
          signature: (await voidBody(m.verifier)).signature,
        }),
        403,
        /does not hold VERIFIER_ROLE/,
        'NotVerifier',
      ],
      [
        'a round with no pot',
        (m) => verdictBody(m.verifier, ZERO_SPLIT, { round: 2n }),
        409,
        /no open pot \(None\)/,
        'PotNotOpen',
      ],
      [
        'a settled pot',
        (m) => {
          withPot(m, { state: 2 });
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        409,
        /no open pot \(Settled\)/,
        'PotNotOpen',
      ],
      [
        'a voided pot',
        (m) => {
          withPot(m, { state: 3 });
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        409,
        /no open pot \(Voided\)/,
        'PotNotOpen',
      ],
      [
        'a refunded pot',
        (m) => {
          withPot(m, { state: 4 });
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        409,
        /no open pot \(Refunded\)/,
        'PotNotOpen',
      ],
      [
        'a payout too few',
        (m) => {
          withPot(m, { players: [...m.players, newBadge().address] });
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        409,
        /2 payouts for 3 players/,
        'PayoutCount',
      ],
      ['a payout too many', (m) => verdictBody(m.verifier, [usdc(20), 0n, 0n]), 409, /3 payouts for 2 players/, 'PayoutCount'],
      ['payouts under the pot', (m) => verdictBody(m.verifier, [usdc(19), 0n]), 409, /add up to 19 USDC, not the pot's 20/, 'PayoutSum'],
      ['payouts over the pot', (m) => verdictBody(m.verifier, [usdc(20), 1n]), 409, /add up to 20.000001 USDC, not the pot's 20/, 'PayoutSum'],
      [
        'an eth_call revert, by name',
        (m) => {
          m.world.reverts.set('settle', [storePotAbi as Abi, 'PayoutSum', [usdc(20), usdc(21)]]);
          return verdictBody(m.verifier, ZERO_SPLIT);
        },
        422,
        /reverts with PayoutSum/,
        'PayoutSum',
      ],
    ],
    withPot,
  );

  it('refuses a replayed verdict and sends it once', async () => {
    const m = match();
    withPot(m);
    const body = await verdictBody(m.verifier, ZERO_SPLIT);
    expect((await m.world.post('/store/settle', body)).status).toBe(202);
    const again = await m.world.post('/store/settle', body);
    expect(again).toMatchObject({ status: 409, body: { error: 'already sent: this signed request is a replay' } });
    expect(m.world.chain.sent).toHaveLength(1);
  });
});

describe('POST /store/void', () => {
  it('sends StorePot.voidPot for a verifier-signed void', async () => {
    const m = match(4);
    withPot(m);
    const body = await voidBody(m.verifier);
    const res = await m.world.post('/store/void', body);
    expect(res).toMatchObject({ status: 202, body: { kind: 'store-void', status: 'sent' } });
    expect(m.world.chain.sent).toHaveLength(1);
    expect(m.world.chain.sent[0]).toMatchObject({ to: STORE_POT, gas: 300_000n });
    expect(decoded(m.world)).toMatchObject({ functionName: 'voidPot', args: [body.void, body.signature] });
  });

  const voidWith = async (m: Match, fields: Record<string, unknown>) => {
    const { void: voiding, signature } = await voidBody(m.verifier);
    return { signature, void: { ...voiding, ...fields } };
  };

  refuses(
    '/store/void',
    [
      ['a body with no void', () => ({}), 400, /void: expected an object/],
      ['a void with no box', (m) => voidWith(m, { box: undefined }), 400, /void.box: expected a string/],
      ['a void with no round', (m) => voidWith(m, { round: undefined }), 400, /void.round: expected an unsigned integer/],
      ['a void with no record', (m) => voidWith(m, { record: undefined }), 400, /void.record: expected 0x-hex bytes/],
      ['a record of the wrong size', (m) => voidWith(m, { record: '0x12' }), 400, /void.record: expected 32 bytes/],
      ['a void with no deadline', (m) => voidWith(m, { deadline: undefined }), 400, /void.deadline: expected an unsigned integer/],
      ['a bad Box label', (m) => voidBody(m.verifier, { box: 'Mumbai 01' }), 400, /void.box/],
      ['a void with no signature', async (m) => ({ ...(await voidBody(m.verifier)), signature: undefined }), 400, /signature: expected 0x-hex bytes/],
      ['an expired deadline', (m) => voidBody(m.verifier, { deadline: BigInt(NOW) }), 400, /deadline/],
      [
        'a signature of 64 bytes',
        async (m) => {
          const body = await voidBody(m.verifier);
          return { ...body, signature: body.signature.slice(0, 130) };
        },
        401,
        /65 bytes/,
        'ECDSAInvalidSignatureLength',
      ],
      [
        'a high s',
        async (m) => {
          const body = await voidBody(m.verifier);
          return { ...body, signature: highSignature(body.signature) };
        },
        401,
        /high s/,
        'ECDSAInvalidSignatureS',
      ],
      ['a signer without VERIFIER_ROLE', () => voidBody(newBadge()), 403, /does not hold VERIFIER_ROLE/, 'NotVerifier'],
      ['a void changed after signing', (m) => voidWith(m, { round: 2n }), 403, /does not hold VERIFIER_ROLE/, 'NotVerifier'],
      ['a round with no pot', (m) => voidBody(m.verifier, { round: 2n }), 409, /no open pot \(None\)/, 'PotNotOpen'],
      [
        'a settled pot',
        (m) => {
          withPot(m, { state: 2 });
          return voidBody(m.verifier);
        },
        409,
        /no open pot \(Settled\)/,
        'PotNotOpen',
      ],
      [
        'an eth_call revert, by name',
        (m) => {
          m.world.reverts.set('voidPot', [storePotAbi as Abi, 'NotVerifier', [m.verifier.address]]);
          return voidBody(m.verifier);
        },
        422,
        /reverts with NotVerifier/,
        'NotVerifier',
      ],
    ],
    withPot,
  );

  it('refuses a replayed void and sends it once', async () => {
    const m = match();
    withPot(m);
    const body = await voidBody(m.verifier);
    expect((await m.world.post('/store/void', body)).status).toBe(202);
    const again = await m.world.post('/store/void', body);
    expect(again).toMatchObject({ status: 409, body: { error: 'already sent: this signed request is a replay' } });
    expect(m.world.chain.sent).toHaveLength(1);
  });
});

describe('POST /store/refund', () => {
  const refund = { box: BOX, round: 1 };
  const overdue = BigInt(NOW - 3600);

  it('refunds an open pot for anyone, an hour after it opened', async () => {
    const m = match();
    withPot(m, { opened: overdue });
    const res = await m.world.post('/store/refund', refund);
    expect(res).toMatchObject({ status: 202, body: { kind: 'store-refund', status: 'sent' } });
    expect(m.world.chain.sent).toHaveLength(1);
    expect(m.world.chain.sent[0]).toMatchObject({ to: STORE_POT, gas: 300_000n });
    expect(decoded(m.world)).toMatchObject({ functionName: 'refund', args: [BOX, 1n] });
  });

  refuses('/store/refund', [
    ['a bad Box label', () => ({ box: 'Mumbai 01', round: 1 }), 400, /box: /],
    ['a body with no round', () => ({ box: BOX }), 400, /round: expected an unsigned integer/],
    ['a round with no pot', () => refund, 409, /no open pot \(None\)/, 'PotNotOpen'],
    [
      'a settled pot',
      (m) => {
        withPot(m, { opened: overdue, state: 2 });
        return refund;
      },
      409,
      /no open pot \(Settled\)/,
      'PotNotOpen',
    ],
    [
      'a voided pot',
      (m) => {
        withPot(m, { opened: overdue, state: 3 });
        return refund;
      },
      409,
      /no open pot \(Voided\)/,
      'PotNotOpen',
    ],
    [
      'a refunded pot',
      (m) => {
        withPot(m, { opened: overdue, state: 4 });
        return refund;
      },
      409,
      /no open pot \(Refunded\)/,
      'PotNotOpen',
    ],
    [
      'a pot opened less than an hour ago',
      (m) => {
        withPot(m, { opened: BigInt(NOW - 3599) });
        return refund;
      },
      409,
      /refunded from 1800000001/,
      'TooEarly',
    ],
    [
      'an eth_call revert, by name',
      (m) => {
        withPot(m, { opened: overdue });
        m.world.reverts.set('refund', [storePotAbi as Abi, 'TooEarly', [BigInt(NOW + 5)]]);
        return refund;
      },
      422,
      /reverts with TooEarly/,
      'TooEarly',
    ],
  ]);
});

describe('a revert only the gas estimate sees', () => {
  // A direct `refund` mined between the `eth_call` and the estimate: the pot's end is a final answer, not a node's fault.
  const ended = () => nodeRevert(new Revert(storePotAbi as Abi, 'PotNotOpen', [BOX, 1n]));
  const requests: [string, (m: Match) => unknown][] = [
    ['/store/settle', (m) => verdictBody(m.verifier, ZERO_SPLIT)],
    ['/store/void', (m) => voidBody(m.verifier)],
    ['/store/refund', () => ({ box: BOX, round: 1 })],
  ];

  for (const [path, body] of requests) {
    it(`is a named 422 from ${path}, with no transaction`, async () => {
      const m = match();
      withPot(m, { opened: BigInt(NOW - 3600) });
      m.world.chain.estimateError = ended();
      const res = await m.world.post(path, await body(m));
      expect(res).toEqual({ status: 422, body: { error: 'the call reverts with PotNotOpen', revert: 'PotNotOpen' } });
      expect(m.world.chain.sent).toHaveLength(0);
    });
  }

  it('leaves a node that fails a 502', async () => {
    const m = match();
    withPot(m);
    m.world.chain.estimateError = Object.assign(new Error('upstream gone'), { code: -32000 });
    const res = await m.world.post('/store/settle', await verdictBody(m.verifier, ZERO_SPLIT));
    expect(res.status).toBe(502);
    expect(m.world.chain.sent).toHaveLength(0);
  });
});

describe('one transaction in flight per round', () => {
  const overdue = BigInt(NOW - 3600);
  const pending = { status: 409, body: { error: `a request for pot:${BOX}:1 is already pending` } };
  // Each signed request takes a deadline, so a second one is a new message and not a replay of the first.
  const requests: [string, string, (m: Match, deadline: bigint) => unknown][] = [
    ['a verdict', '/store/settle', (m, deadline) => verdictBody(m.verifier, ZERO_SPLIT, { deadline })],
    ['a void', '/store/void', (m, deadline) => voidBody(m.verifier, { deadline })],
    ['a refund', '/store/refund', () => ({ box: BOX, round: 1 })],
  ];

  for (const [first, firstPath, firstBody] of requests) {
    for (const [second, secondPath, secondBody] of requests) {
      it(`refuses ${second} while ${first} is pending`, async () => {
        const m = match();
        withPot(m, { opened: overdue });
        expect((await m.world.post(firstPath, await firstBody(m, BigInt(NOW + 600)))).status).toBe(202);
        expect(await m.world.post(secondPath, await secondBody(m, BigInt(NOW + 700)))).toMatchObject(pending);
        expect(m.world.chain.sent).toHaveLength(1);
      });
    }
  }

  it('shares the lock with a DuelPot request of the same round', async () => {
    const m = match();
    withPot(m, { opened: overdue });
    const { world, players } = m;
    const [a, b] = players as [Address, Address];
    world.pots.set(`${BOX}:1`, { a, b, amount: usdc(10), opened: overdue, state: 1, game: keccak256(toHex('stockduel')) });
    expect((await world.post('/duel/refund', { box: BOX, round: 1 })).status).toBe(202);
    expect(await world.post('/store/refund', { box: BOX, round: 1 })).toMatchObject(pending);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('frees the round once a verdict fails, so a void can follow', async () => {
    const m = match();
    withPot(m);
    expect((await m.world.post('/store/settle', await verdictBody(m.verifier, ZERO_SPLIT))).status).toBe(202);
    m.world.chain.receipts.set(m.world.chain.sent[0]!.hash, { status: 'reverted', block: 100 });
    m.world.reverts.set('settle', [storePotAbi as Abi, 'PayoutSum', [usdc(20), usdc(21)]]);
    m.world.chain.head++;
    await m.world.relay.poll();
    expect((await m.world.post('/store/void', await voidBody(m.verifier))).status).toBe(202);
    expect(m.world.chain.sent).toHaveLength(2);
  });
});

describe('POST /store/topup', () => {
  const topped = (world: World) => decodeFunctionData({ abi: fakeUsdcAbi, data: world.chain.sent[0]!.data! });

  it('mints 100 Store USDC to a player holding less than 25', async () => {
    const world = new World();
    const player = newBadge().address;
    world.storeUsdc.set(player.toLowerCase(), usdc(24.99));
    const res = await world.post('/store/topup', { player });
    expect(res).toMatchObject({ status: 202, body: { kind: 'store-topup', status: 'sent' } });
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]).toMatchObject({ to: STORE_USDC, gas: 300_000n });
    expect(topped(world)).toMatchObject({ functionName: 'mint', args: [player, usdc(100)] });
  });

  it('counts only Store USDC, not the first token', async () => {
    const world = new World();
    const player = newBadge().address;
    world.usdc.set(player.toLowerCase(), usdc(100));
    expect((await world.post('/store/topup', { player })).status).toBe(202);
  });

  it('takes an ENS name, resolved through the Universal Resolver', async () => {
    const world = new World();
    const player = newBadge().address;
    world.ensNames.set('nova.gamebox.eth', player);
    expect((await world.post('/store/topup', { player: 'Nova.gamebox.eth' })).status).toBe(202);
    expect(topped(world).args?.[0]).toBe(player);
  });

  refuses('/store/topup', [
    ['a body with no player', () => ({}), 400, /player: expected a string/],
    ['something that is neither an address nor a name', () => ({ player: 'not a name' }), 400, /address or an ENS name/],
    ['a name that does not resolve', () => ({ player: 'nobody.gamebox.eth' }), 404, /does not resolve/],
    [
      'a player who holds 25 Store USDC or more',
      (m) => {
        m.world.storeUsdc.set(m.players[0]!.toLowerCase(), usdc(25));
        return { player: m.players[0] };
      },
      409,
      /already holds 25 USDC/,
    ],
    [
      'an eth_call revert (the relayer is not the minter), by name',
      (m) => {
        m.world.reverts.set('mint', [fakeUsdcAbi as Abi, 'AccessControlUnauthorizedAccount', [m.world.relayerAccount.address, `0x${'00'.repeat(32)}`]]);
        return { player: newBadge().address };
      },
      422,
      /reverts with AccessControlUnauthorizedAccount/,
      'AccessControlUnauthorizedAccount',
    ],
  ]);

  it('allows one top-up per player per 10 minutes, apart from /usdc/topup', async () => {
    const world = new World();
    const player = newBadge().address;
    expect((await world.post('/usdc/topup', { player })).status).toBe(202);
    expect((await world.post('/store/topup', { player })).status).toBe(202);
    world.chain.head++;
    for (const { hash } of world.chain.sent) world.chain.receipts.set(hash, { status: 'success', block: 100 });
    await world.relay.poll();
    const again = await world.post('/store/topup', { player });
    expect(again).toMatchObject({ status: 429, body: { error: 'rate limit: one top-up per player per 10 minutes' } });
    expect(world.chain.sent).toHaveLength(2);
  });

  it('refuses a second top-up while the first is pending', async () => {
    const world = new World();
    const player = newBadge().address;
    expect((await world.post('/store/topup', { player })).status).toBe(202);
    const again = await world.post('/store/topup', { player });
    expect(again).toMatchObject({ status: 409, body: { error: `a request for store-topup:${player.toLowerCase()} is already pending` } });
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 300 top-ups a day in all', async () => {
    const world = new World();
    await world.store.put('rate:store-topup:all', Array.from({ length: 300 }, (_, i) => NOW - i));
    const res = await world.post('/store/topup', { player: newBadge().address });
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 300 top-ups per day' } });
    expect(world.chain.sent).toHaveLength(0);
  });

  it('keeps one address from spending the whole day: fresh players get 60 top-ups from it, and the rest are left for others', async () => {
    const world = new World();
    for (let i = 0; i < 60; i++) expect((await world.post('/store/topup', { player: newBadge().address })).status).toBe(202);
    const res = await world.post('/store/topup', { player: newBadge().address });
    expect(res).toMatchObject({ status: 429, body: { error: 'rate limit: 60 top-ups per day from one address' } });
    expect(world.chain.sent).toHaveLength(60);
    const other = await world.post('/store/topup', { player: newBadge().address }, { 'cf-connecting-ip': '203.0.113.8' });
    expect(other.status).toBe(202);
  });
});

describe('before StorePot is deployed', () => {
  const routes: [string, string][] = [
    ['/store/open', 'StorePot'],
    ['/store/settle', 'StorePot'],
    ['/store/void', 'StorePot'],
    ['/store/refund', 'StorePot'],
    ['/store/topup', 'Store USDC'],
  ];
  const withoutStore = (world: World, missing: { storePot?: undefined; storeUsdc?: undefined }) => {
    world.deps.ctx.addresses = { ...addresses, ...missing };
  };

  for (const [path, contract] of routes) {
    it(`answers ${path} with a 404 and touches nothing, whatever the body`, async () => {
      const world = new World();
      withoutStore(world, { storePot: undefined, storeUsdc: undefined });
      const res = await world.post(path, {});
      expect(res).toEqual({ status: 404, body: { error: `${contract} is not deployed yet` } });
      expect(world.chain.calls.size).toBe(0);
    });
  }

  it('refuses a stake while only the pot is deployed', async () => {
    const { world, players } = match();
    withoutStore(world, { storeUsdc: undefined });
    const res = await world.post('/store/open', storeStakeBody(world, players));
    expect(res).toEqual({ status: 404, body: { error: 'Store USDC is not deployed yet' } });
    expect(world.chain.sent).toHaveLength(0);
  });

  it('reads the pot and its token each from its own key in the deployments', async () => {
    const entry = (address: Address) => ({ address, deployBlock: 1, txHash: '0x', verified: false });
    vi.resetModules();
    vi.doMock('../../../deployments/sepolia.json', async (original) => {
      const { default: sepolia } = await original<{ default: { contracts: object } }>();
      const contracts = { ...sepolia.contracts, StorePot: entry(STORE_POT), StoreUSDC: entry(STORE_USDC) };
      return { default: { ...sepolia, contracts } };
    });
    const { deployedAddresses } = await import('../src/request.ts');
    vi.doUnmock('../../../deployments/sepolia.json');
    expect(deployedAddresses()).toMatchObject({ storePot: getAddress(STORE_POT), storeUsdc: getAddress(STORE_USDC) });
  });

  it('leaves the other routes alone', async () => {
    const world = new World();
    withoutStore(world, { storePot: undefined, storeUsdc: undefined });
    expect((await world.post('/usdc/topup', { player: newBadge().address })).status).toBe(202);
  });
});
