import type { PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';

import { stockListings } from './deployments.ts';
import { SAMPLES, blockAt, sampleBlocks } from './snapshot.ts';

/** A chain whose block n is stamped `stamp(n)`, counting the blocks read. */
function chain(stamp: (n: bigint) => bigint) {
  let reads = 0;
  const client = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
      reads++;
      return { number: blockNumber, timestamp: stamp(blockNumber) };
    },
  } as unknown as PublicClient;
  return { client, reads: () => reads };
}

describe('blockAt', () => {
  it('finds the last block at or before the time on an even chain', async () => {
    // Ten blocks a second from t = 1,000,000.
    const stamp = (n: bigint) => 1_000_000n + n / 10n;
    const { client, reads } = chain(stamp);
    const head = { n: 108_000_000n, t: stamp(108_000_000n) };
    const target = head.t - 86_400n;
    const found = await blockAt(client, target, head);
    expect(stamp(found)).toBeLessThanOrEqual(target);
    expect(target - stamp(found)).toBeLessThanOrEqual(30n);
    expect(reads()).toBeLessThan(8);
  });

  it('gets close on an uneven chain', async () => {
    // Busy then quiet: 20 blocks a second up to block 50M, 2 a second after.
    const stamp = (n: bigint) => (n < 50_000_000n ? n / 20n : 2_500_000n + (n - 50_000_000n) / 2n);
    const { client } = chain(stamp);
    const head = { n: 51_000_000n, t: stamp(51_000_000n) };
    const target = head.t - 86_400n;
    const found = await blockAt(client, target, head);
    expect(stamp(found)).toBeLessThanOrEqual(target);
    expect(target - stamp(found)).toBeLessThanOrEqual(30n);
  });
});

describe('sampleBlocks', () => {
  it('spreads SAMPLES blocks from the open to the head, both ends included', () => {
    const blocks = sampleBlocks(100n, 2500n);
    expect(blocks).toHaveLength(SAMPLES);
    expect(blocks[0]).toBe(100n);
    expect(blocks.at(-1)).toBe(2500n);
    expect(blocks[1]).toBe(200n);
  });
});

describe('deployments/robinhood.json', () => {
  it('lists a pool for every stock', () => {
    const listings = stockListings();
    expect(listings.length).toBeGreaterThanOrEqual(20);
    for (const listing of listings) expect(listing.pool, listing.ticker).not.toBeNull();
  });
});
