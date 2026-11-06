import { HttpRequestError, TimeoutError } from 'viem';
import { describe, expect, it } from 'vitest';

import type { Prepared } from '../src/request.ts';
import { NOW, World, addresses } from './world.ts';

const request = (n: number): Prepared => ({
  kind: 'execute',
  to: addresses.results,
  data: '0x',
  value: 0n,
  gas: 100_000n,
  replay: { key: `digest-${n}`, until: 0 },
  locks: [`lock-${n}`],
});

describe('the nonce queue', () => {
  it('gives two parallel requests consecutive nonces', async () => {
    const world = new World();
    world.chain.chainNonce = 41;
    const [a, b] = await Promise.all([world.relay.submit(request(1), 'ip'), world.relay.submit(request(2), 'ip')]);
    expect(a.ok && b.ok).toBe(true);
    expect(world.chain.sent.map((tx) => tx.nonce)).toEqual([41, 42]);
    // It reads the nonce from the chain once, then counts.
    expect(world.chain.calls.get('eth_getTransactionCount')).toBe(1);
  });

  it('sends with the configured tip and a fee cap of three base fees', async () => {
    const world = new World();
    await world.relay.submit(request(1), 'ip');
    const { parseTransaction } = await import('viem');
    const tx = parseTransaction(world.chain.sent[0]!.raw);
    expect(tx.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(tx.maxFeePerGas).toBe(3n * 1_000_000_000n + 2_000_000_000n);
  });

  it('resyncs on a nonce error and retries once', async () => {
    const world = new World();
    await world.relay.submit(request(1), 'ip');
    // Another sender used the wallet: the queue's next nonce (1) is now too low.
    world.chain.chainNonce = 9;
    const res = await world.relay.submit(request(2), 'ip');
    expect(res).toMatchObject({ ok: true, tx: { status: 'sent' } });
    expect(world.chain.sent.map((tx) => tx.nonce)).toEqual([0, 9]);
  });

  it('gives up after one retry, and frees the request to be sent again', async () => {
    const world = new World();
    world.chain.sendErrors = ['nonce too low', 'nonce too low'];
    const res = await world.relay.submit(request(1), 'ip');
    expect(res).toMatchObject({ ok: true, tx: { status: 'failed', error: 'not sent: nonce too low' } });
    expect(world.chain.sent).toHaveLength(0);
    const again = await world.relay.submit(request(1), 'ip');
    expect(again).toMatchObject({ ok: true, tx: { status: 'sent' } });
  });

  it('does not retry other send errors', async () => {
    const world = new World();
    world.chain.sendErrors = ['insufficient funds for gas * price + value'];
    const res = await world.relay.submit(request(1), 'ip');
    expect(res).toMatchObject({ ok: true, tx: { status: 'failed' } });
    expect(world.chain.calls.get('eth_sendRawTransaction')).toBe(1);
  });
});

describe('a send with no answer', () => {
  const url = 'https://node.test';
  const timeout = () => new TimeoutError({ body: {}, url });
  const until = NOW + 600;
  const signed = (n = 1): Prepared => ({ ...request(n), replay: { key: `digest-${n}`, until } });
  const sent = async (world: World, n = 1) => {
    const res = await world.relay.submit(signed(n), 'ip');
    if (!res.ok) throw new Error(res.error);
    return res.tx;
  };

  const noAnswers: [string, () => Error][] = [
    ['a timeout', timeout],
    ['a dropped connection', () => new HttpRequestError({ url, cause: new Error('socket hang up') })],
    ['a 502', () => new HttpRequestError({ url, status: 502 })],
    ['a node reporting its own failure', () => Object.assign(new Error('internal error'), { code: -32603 })],
  ];

  for (const [what, error] of noAnswers) {
    it(`stays sent under its own hash after ${what}: the node may have taken it`, async () => {
      const world = new World();
      world.chain.lostSends = [{ error: error(), taken: true }];
      expect(await sent(world)).toMatchObject({ status: 'sent', hash: world.chain.sent[0]!.hash });
      expect(world.wakes).toBe(1);
    });
  }

  const refusals: [string, () => Error][] = [
    ['a rate limit', () => new HttpRequestError({ url, status: 429 })],
    ['a bad key', () => new HttpRequestError({ url, status: 401 })],
    ['the node refusing the transaction', () => Object.assign(new Error('insufficient funds'), { code: -32000 })],
  ];

  for (const [what, error] of refusals) {
    it(`fails at once on ${what}: an answer is final, and frees the request to be sent again`, async () => {
      const world = new World();
      world.chain.lostSends = [{ error: error(), taken: false }];
      expect(await sent(world)).toMatchObject({ status: 'failed' });
      expect(await sent(world)).toMatchObject({ status: 'sent' });
    });
  }

  it('fails at once with no deadline, which nothing could end', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: false }];
    const res = await world.relay.submit(request(1), 'ip');
    expect(res).toMatchObject({ ok: true, tx: { status: 'failed' } });
  });

  it('follows a transaction the node took to its receipt', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: true }];
    const { id, hash } = await sent(world);
    world.chain.receipts.set(hash!, { status: 'success', block: 100 });
    world.chain.head++;
    await world.relay.poll();
    expect(await world.relay.status(id)).toMatchObject({ status: 'done', block: 100 });
  });

  it('refuses a replay of it, and its lock, while it is in doubt', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: false }];
    await sent(world);
    expect(await world.relay.submit(signed(), 'ip')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/replay/) });
    const sameLock = { ...signed(2), locks: ['lock-1'] };
    expect(await world.relay.submit(sameLock, 'ip')).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/already pending/) });
  });

  it('reads the nonce from the chain for the next send, whichever way it went', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: true }];
    await sent(world, 1);
    await sent(world, 2);
    world.chain.lostSends = [{ error: timeout(), taken: false }];
    await sent(world, 3);
    await sent(world, 4);
    expect(world.chain.sent.map((tx) => tx.nonce)).toEqual([0, 1, 2]);
  });

  it('fails one that never appears once its deadline has passed, and frees its lock', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: false }];
    const { id } = await sent(world);

    world.time = until + 60;
    await world.relay.poll();
    expect(await world.relay.status(id)).toMatchObject({ status: 'sent' });

    world.time = until + 61;
    await world.relay.poll();
    expect(await world.relay.status(id)).toMatchObject({ status: 'failed', error: 'not mined by its deadline' });
    const sameLock = { ...signed(2), replay: { key: 'digest-2', until: until + 600 }, locks: ['lock-1'] };
    expect(await world.relay.submit(sameLock, 'ip')).toMatchObject({ ok: true, tx: { status: 'sent' } });
  });

  it('takes a late receipt over the deadline', async () => {
    const world = new World();
    world.chain.lostSends = [{ error: timeout(), taken: true }];
    const { id, hash } = await sent(world);
    world.time = until + 3600;
    world.chain.receipts.set(hash!, { status: 'success', block: 100 });
    await world.relay.poll();
    expect(await world.relay.status(id)).toMatchObject({ status: 'in-block', block: 100 });
  });

  it('never ends a request with no deadline for want of a receipt', async () => {
    const world = new World();
    const res = await world.relay.submit(request(1), 'ip');
    world.time = NOW + 86_400;
    await world.relay.poll();
    expect(res.ok && (await world.relay.status(res.tx.id))).toMatchObject({ status: 'sent' });
  });
});
