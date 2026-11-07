// A market snapshot: every listed stock's quote at Robinhood Chain's latest block, with the day behind it sampled
// SAMPLES times. The block numbers are the replay proof: anyone can read the same pools at the same blocks.

import type { PublicClient } from 'viem';

import { type StockListing, ROBINHOOD_CHAIN_ID, stockListings } from './deployments.ts';
import { pooled, readPools, stockIsToken0 } from './reads.ts';
import { type StockQuote, quoteOf } from './stats.ts';

const DAY_S = 86_400n;
/** Day samples, evenly spaced in blocks from 24 hours ago to now, both ends included. */
export const SAMPLES = 25;
/** The block 24 hours back is found to within this many seconds. */
const NEAR_S = 30n;
const SEARCH_STEPS = 12;

export interface MarketSnapshot {
  readonly chainId: number;
  /** The block the quotes are read at. */
  readonly block: number;
  /** Its timestamp, ms since the epoch. */
  readonly at: number;
  /** The first day sample's block, about 24 hours before `block`. */
  readonly openBlock: number;
  readonly quotes: Readonly<Record<string, StockQuote>>;
}

interface Point {
  readonly n: bigint;
  readonly t: bigint;
}

async function pointAt(client: PublicClient, n: bigint): Promise<Point> {
  const block = await client.getBlock({ blockNumber: n });
  return { n, t: block.timestamp };
}

/** The last block at or before `target` (seconds), by interpolating between known blocks. */
export async function blockAt(client: PublicClient, target: bigint, head: Point): Promise<bigint> {
  let hi = head;
  let lo = await pointAt(client, hi.n > 1_000_000n ? hi.n - 1_000_000n : 0n);
  while (lo.t > target && lo.n > 0n) lo = await pointAt(client, lo.n > hi.n - lo.n ? lo.n - (hi.n - lo.n) : 0n);
  if (lo.t > target) return lo.n;
  for (let step = 0; step < SEARCH_STEPS && hi.n - lo.n > 1n; step++) {
    if (target - lo.t <= NEAR_S) return lo.n;
    const span = hi.t - lo.t;
    let guess = span === 0n ? (lo.n + hi.n) / 2n : lo.n + ((target - lo.t) * (hi.n - lo.n)) / span;
    if (guess <= lo.n) guess = lo.n + 1n;
    if (guess >= hi.n) guess = hi.n - 1n;
    const point = await pointAt(client, guess);
    if (point.t <= target) lo = point;
    else hi = point;
  }
  return lo.n;
}

/** The blocks to sample, oldest first: SAMPLES of them from `open` to `head`. */
export function sampleBlocks(open: bigint, head: bigint): bigint[] {
  const span = head - open;
  const last = BigInt(SAMPLES - 1);
  return Array.from({ length: SAMPLES }, (_, i) => open + (span * BigInt(i)) / last);
}

/** Reads every listed stock's quote now. Throws if a pool can't be read at the head block. */
export async function readMarket(client: PublicClient, listings: readonly StockListing[] = stockListings()): Promise<MarketSnapshot> {
  const listed = pooled(listings);
  const head = await client.getBlock({ blockTag: 'latest' });
  const headPoint = { n: head.number, t: head.timestamp };
  const open = await blockAt(client, head.timestamp - DAY_S, headPoint);
  const blocks = sampleBlocks(open, head.number);
  const reads = await Promise.all(blocks.map((block, i) => readPools(client, listed, block, i === blocks.length - 1)));
  const quotes: Record<string, StockQuote> = {};
  listed.forEach((listing, s) => {
    const quote = quoteOf(
      reads.map((sample) => sample[s] ?? null),
      stockIsToken0(listing.token),
    );
    if (!quote) throw new Error(`${listing.ticker}'s pool has no state at block ${head.number}`);
    quotes[listing.ticker] = quote;
  });
  return { chainId: ROBINHOOD_CHAIN_ID, block: Number(head.number), at: Number(head.timestamp) * 1000, openBlock: Number(open), quotes };
}
