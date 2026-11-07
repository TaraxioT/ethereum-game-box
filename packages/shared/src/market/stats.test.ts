import { describe, expect, it } from 'vitest';

import { DEPTH_BAND, type PoolRead, depthOf, priceOf, quoteOf } from './stats.ts';

const Q96 = 2n ** 96n;
const ONE = 10n ** 18n;

/** A read whose raw price (token1 per token0, raw units) is `raw`. */
function readAt(raw: number, liquidity = 0n, multiplier = ONE): PoolRead {
  return { sqrtPriceX96: BigInt(Math.round(Math.sqrt(raw) * Number(Q96))), liquidity, multiplier };
}

describe('priceOf', () => {
  it('reads USDG per stock when the stock is token0', () => {
    // $250 a share: 250e6 USDG raw per 1e18 stock raw.
    expect(priceOf(readAt(250e6 / 1e18), true)).toBeCloseTo(250, 6);
  });

  it('reads stock per USDG when the stock is token1', () => {
    expect(priceOf(readAt(1e18 / 188.29e6), false)).toBeCloseTo(188.29, 6);
  });

  it('scales raw tokens to shares by the ERC-8056 multiplier', () => {
    const doubled = readAt(100e6 / 1e18, 0n, 2n * ONE);
    expect(priceOf(doubled, true)).toBeCloseTo(50, 6);
  });
});

describe('depthOf', () => {
  it('matches the amounts a ±2% move takes out of a constant-liquidity range', () => {
    // Stock is token0 at $100: sqrtP in raw units.
    const raw = 100e6 / 1e18;
    const liquidity = 10n ** 15n;
    const sqrt = Math.sqrt(raw);
    const r = Math.sqrt(1 + DEPTH_BAND);
    const usdgOut = Number(liquidity) * (sqrt - sqrt / r);
    const stockOut = Number(liquidity) * (1 / sqrt - 1 / (sqrt * r));
    const expected = (usdgOut + stockOut * raw) / 1e6;
    expect(depthOf(readAt(raw, liquidity), true)).toBeCloseTo(expected, 3);
  });

  it('is the same pool depth whichever way round the pair sorts', () => {
    const liquidity = 10n ** 15n;
    const asToken0 = depthOf(readAt(100e6 / 1e18, liquidity), true);
    // The same pool with the tokens swapped: the raw price inverts, the liquidity stays.
    const asToken1 = depthOf(readAt(1e18 / 100e6, liquidity), false);
    expect(asToken1).toBeCloseTo(asToken0, 3);
  });
});

describe('quoteOf', () => {
  const at = (usd: number, liquidity = 0n) => readAt(usd * 1e6 / 1e18, liquidity);

  it('takes the price now, the mean of the samples, the move from the first sample, and the depth now', () => {
    const quote = quoteOf([at(100), at(110), at(120, 10n ** 15n)], true);
    expect(quote).toEqual({ price: 120, avgPrice: 110, change24h: 20, liquidity: expect.any(Number) });
    expect(quote?.liquidity).toBeGreaterThan(0);
  });

  it('skips samples from before the pool existed', () => {
    const quote = quoteOf([null, { sqrtPriceX96: 0n, liquidity: 0n, multiplier: ONE }, at(50), at(55)], true);
    expect(quote?.change24h).toBe(10);
    expect(quote?.avgPrice).toBe(52.5);
  });

  it('is null without a read now', () => {
    expect(quoteOf([at(100), null], true)).toBeNull();
  });
});
