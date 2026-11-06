import { describe, expect, it } from 'vitest';

import type { Prepared } from '../src/request.ts';
import { World, addresses } from './world.ts';

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

  it('sends with the configured tip', async () => {
    const world = new World();
    await world.relay.submit(request(1), 'ip');
    const { parseTransaction } = await import('viem');
    const tx = parseTransaction(world.chain.sent[0]!.raw);
    expect(tx.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(tx.maxFeePerGas).toBe(2n * 1_000_000_000n + 2_000_000_000n);
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
