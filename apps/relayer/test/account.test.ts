import { fullName, p256AccountAbi, p256AccountFactoryAbi, permissionedResolverAbi } from '@egb/shared/names';
import { type Abi, type Address, decodeFunctionData, encodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { describe, expect, it } from 'vitest';

import { CREATES_STORAGE_GAS } from '../src/request.ts';
import { executeBody, setTextData } from './bodies.ts';
import { BOX, BOX_ACCOUNT, BOX_RESOLVER, NOW, World, addresses, boxKey } from './world.ts';

const OTHER: Address = '0x00000000000000000000000000000000000000D1';
const sentCall = (world: World) => decodeFunctionData({ abi: p256AccountAbi, data: world.chain.sent[0]!.data! });

describe('POST /account/execute', () => {
  it("sends P256Account.execute for a raw signature by the account's key", async () => {
    const world = new World();
    const res = await world.post('/account/execute', executeBody(world));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ kind: 'execute', status: 'sent' });
    expect(world.chain.sent).toHaveLength(1);
    expect(world.chain.sent[0]).toMatchObject({ to: BOX_ACCOUNT.toLowerCase(), gas: 300_000n });
    expect(sentCall(world).functionName).toBe('execute');
  });

  it("takes a passkey's WebAuthn assertion", async () => {
    const world = new World();
    const res = await world.post('/account/execute', executeBody(world, { sign: { as: 'webauthn' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
  });

  it('sends executeBatch for a batch, under one signature', async () => {
    const world = new World();
    const calls = [
      { target: BOX_RESOLVER, value: 0n, data: setTextData('lastSeen', String(NOW)) },
      { target: BOX_RESOLVER, value: 0n, data: setTextData('game', 'quickdraw') },
    ];
    const res = await world.post('/account/execute', executeBody(world, { calls, sign: { as: 'webauthn' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const call = sentCall(world);
    expect(call.functionName).toBe('executeBatch');
    expect(call.args[0]).toEqual(calls);
  });

  it('takes a call to a contract in deployments/sepolia.json', async () => {
    const world = new World();
    const data = encodeFunctionData({ abi: p256AccountFactoryAbi, functionName: 'deploy', args: [boxKey().qx, boxKey().qy] });
    expect((await world.post('/account/execute', executeBody(world, { target: addresses.factory, data }))).status).toBe(202);
  });

  it('takes rotateKey on the account itself', async () => {
    const world = new World();
    const next = boxKey();
    const data = encodeFunctionData({ abi: p256AccountAbi, functionName: 'rotateKey', args: [next.qx, next.qy] });
    expect((await world.post('/account/execute', executeBody(world, { target: BOX_ACCOUNT, data }))).status).toBe(202);
  });

  it('serves an account that rotated its key, found by the factory event', async () => {
    const world = new World();
    const key = boxKey();
    world.addAccount(OTHER, key, { rotated: true });
    world.resolvers.set('alice', BOX_RESOLVER);
    const body = executeBody(world, { account: OTHER, key, data: setTextData('url', 'https://x.test', 'alice') });
    expect((await world.post('/account/execute', body)).status).toBe(202);
  });

  it('sends a call that creates storage with the explicit limit', async () => {
    const world = new World();
    world.chain.estimate = 1_200_000n;
    await world.post('/account/execute', executeBody(world));
    expect(world.chain.sent[0]!.gas).toBe(CREATES_STORAGE_GAS);
  });

  const name = toHex(packetToBytes(fullName(BOX)));
  const refusals: [string, (world: World) => unknown, number, RegExp][] = [
    ['a raw signature with a high s', (world) => executeBody(world, { sign: { as: 'raw', highS: true } }), 401, /high s/],
    ['a signature by another key', (world) => executeBody(world, { key: boxKey() }), 401, /not signed by the account's key/],
    [
      'a passkey assertion of another challenge',
      (world) => executeBody(world, { sign: { as: 'webauthn', flaw: 'challenge' } }),
      401,
      /challenge is not the digest/,
    ],
    ['a passkey assertion of another type', (world) => executeBody(world, { sign: { as: 'webauthn', flaw: 'type' } }), 401, /webauthn.get/],
    ['a passkey assertion with no user verification', (world) => executeBody(world, { sign: { as: 'webauthn', flaw: 'no-uv' } }), 401, /not verified/],
    ['a passkey assertion with a high s', (world) => executeBody(world, { sign: { as: 'webauthn', flaw: 'high-s' } }), 401, /high s/],
    ['a signature that is neither form', (world) => ({ ...executeBody(world), signature: '0x1234' }), 401, /not a raw or WebAuthn/],
    ['a target outside the allowlist', (world) => executeBody(world, { target: OTHER, data: '0xdeadbeef' }), 403, /not in deployments/],
    [
      'a resolver call that is not a record write',
      (world) =>
        executeBody(world, {
          data: encodeFunctionData({ abi: permissionedResolverAbi, functionName: 'grantRoles', args: [1n, 1n, OTHER] }),
        }),
      403,
      /grantRoles is not on the allowlist/,
    ],
    [
      'a record outside gamebox.eth',
      (world) =>
        executeBody(world, {
          data: encodeFunctionData({ abi: permissionedResolverAbi, functionName: 'setText', args: [toHex(packetToBytes('alice.eth')), 'a', 'b'] }),
        }),
      403,
      /not on a <label>.gamebox.eth name/,
    ],
    ['a record sent to another resolver', (world) => executeBody(world, { target: OTHER }), 403, /not the resolver of mumbai-01.gamebox.eth/],
    [
      'a self-call that is not rotateKey',
      (world) =>
        executeBody(world, {
          target: BOX_ACCOUNT,
          data: encodeFunctionData({ abi: permissionedResolverAbi, functionName: 'setText', args: [name, 'a', 'b'] }),
        }),
      403,
      /must be rotateKey/,
    ],
    [
      'rotateKey to a key off the curve',
      (world) =>
        executeBody(world, {
          target: BOX_ACCOUNT,
          data: encodeFunctionData({ abi: p256AccountAbi, functionName: 'rotateKey', args: [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`] }),
        }),
      400,
      /not a point on P-256/,
    ],
    ['a value', (world) => executeBody(world, { value: 1n }), 403, /value must be 0/],
    ['an account with no code', (world) => executeBody(world, { account: OTHER }), 403, /has no code/],
    [
      'an account the factory did not make',
      (world) => {
        const key = boxKey();
        world.addAccount(OTHER, key, { madeByFactory: false });
        return executeBody(world, { account: OTHER, key });
      },
      403,
      /not a P256Account made by P256AccountFactory/,
    ],
    [
      'a contract that is not a P256Account',
      (world) => {
        world.chain.code.set(OTHER.toLowerCase(), '0x60');
        return executeBody(world, { account: OTHER });
      },
      403,
      /not a P256Account/,
    ],
    ['an expired deadline', (world) => ({ ...executeBody(world), deadline: String(NOW - 5) }), 400, /deadline/],
    ['both call and calls', (world) => ({ ...executeBody(world), calls: [] }), 400, /expected call or calls/],
    ['an empty batch', (world) => ({ ...executeBody(world), call: undefined, calls: [] }), 400, /expected 1 to 16 calls/],
    ['a malformed call', (world) => ({ ...executeBody(world), call: { target: '0x12', value: '0', data: '0x' } }), 400, /call.target/],
    [
      'a used nonce',
      (world) => {
        world.usedNonces.add(`${BOX_ACCOUNT.toLowerCase()}:7`);
        return executeBody(world);
      },
      409,
      /nonce 7 .* is already used/,
    ],
    [
      'an eth_call revert, passed on by name',
      (world) => {
        world.reverts.set('execute', [p256AccountAbi as Abi, 'DeadlineExpired', [1n]]);
        return executeBody(world);
      },
      422,
      /reverts with DeadlineExpired/,
    ],
  ];

  for (const [what, body, status, reason] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/account/execute', body(world));
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a replayed execute and sends it once', async () => {
    const world = new World();
    const body = executeBody(world);
    expect((await world.post('/account/execute', body)).status).toBe(202);
    const again = await world.post('/account/execute', body);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/replay/);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 30 calls per hour from one account', async () => {
    const world = new World();
    for (let nonce = 0n; nonce < 30n; nonce++) {
      expect((await world.post('/account/execute', executeBody(world, { nonce }))).status).toBe(202);
    }
    const next = await world.post('/account/execute', executeBody(world, { nonce: 30n }));
    expect(next.status).toBe(429);
    expect(next.body.error).toMatch(/30 calls per hour from one account/);
    const key = boxKey();
    world.addAccount(OTHER, key);
    world.resolvers.set('alice', BOX_RESOLVER);
    const other = executeBody(world, { account: OTHER, key, data: setTextData('url', 'https://x.test', 'alice') });
    expect((await world.post('/account/execute', other)).status).toBe(202);
    expect(world.chain.sent).toHaveLength(31);
  });
});

describe('POST /account/deploy', () => {
  const body = (key = boxKey()) => ({ qx: key.qx, qy: key.qy });

  it("deploys a new key's account through the factory with the explicit limit", async () => {
    const world = new World();
    const key = body();
    const res = await world.post('/account/deploy', key);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ kind: 'deploy', status: 'sent' });
    expect(world.chain.sent[0]).toMatchObject({ to: addresses.factory, gas: CREATES_STORAGE_GAS });
    const call = decodeFunctionData({ abi: p256AccountFactoryAbi, data: world.chain.sent[0]!.data! });
    expect(call).toMatchObject({ functionName: 'deploy', args: [key.qx, key.qy] });
  });

  const refusals: [string, (world: World) => unknown, number, RegExp][] = [
    ['a key off the curve', () => ({ qx: `0x${'01'.repeat(32)}`, qy: `0x${'02'.repeat(32)}` }), 400, /not a point on P-256/],
    ['a malformed key', () => ({ qx: '0x12', qy: body().qy }), 400, /qx: expected 32 bytes/],
    ['an account that is already deployed', (world) => body(world.key), 409, /already deployed/],
    [
      'an eth_call revert, passed on by name',
      (world) => {
        world.reverts.set('deploy', [p256AccountFactoryAbi as Abi, 'FailedDeployment', []]);
        return body();
      },
      422,
      /reverts with FailedDeployment/,
    ],
  ];

  for (const [what, make, status, reason] of refusals) {
    it(`refuses ${what} with no transaction`, async () => {
      const world = new World();
      const res = await world.post('/account/deploy', make(world));
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(reason);
      expect(world.chain.sent).toHaveLength(0);
    });
  }

  it('refuses a second deploy of the same key while the first is pending', async () => {
    const world = new World();
    const key = body();
    expect((await world.post('/account/deploy', key)).status).toBe(202);
    const again = await world.post('/account/deploy', key);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already pending/);
    expect(world.chain.sent).toHaveLength(1);
  });

  it('allows 3 per IP per hour', async () => {
    const world = new World();
    for (let i = 0; i < 3; i++) expect((await world.post('/account/deploy', body())).status).toBe(202);
    const fourth = await world.post('/account/deploy', body());
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/3 account deploys per hour/);
    expect(world.chain.sent).toHaveLength(3);
  });
});
