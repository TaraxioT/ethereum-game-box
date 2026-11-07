// The stock numbers from raw pool reads. Pure. A stock token has 18 decimals and USDG 6, and USDG counts as $1.
//
// - price: the pool's spot price per share (the token's ERC-8056 `uiMultiplier` scales raw tokens to shares).
// - avgPrice: the mean of the day's sampled prices.
// - change24h: percent from the day's first sample to now.
// - liquidity: the pool's depth, the USD it takes to move the price DEPTH_BAND either way at its in-range liquidity.
//   v4 pools share one PoolManager's balance, so depth is the one figure both pool versions give alike.

const Q96 = 2 ** 96;
/** USDG raw units per stock raw unit, for a $1 share: 10^(6 − 18). */
const DECIMALS_SHIFT = 1e12;
const ONE = 1e18;
/** ±2%. */
export const DEPTH_BAND = 0.02;

/** One read of a pool: its sqrt price, its in-range liquidity, and the stock token's share multiplier (1e18 = 1). */
export interface PoolRead {
  readonly sqrtPriceX96: bigint;
  readonly liquidity: bigint;
  readonly multiplier: bigint;
}

export interface StockQuote {
  /** USD, the pool's spot price per share. */
  readonly price: number;
  /** USD, the mean of the day's samples. */
  readonly avgPrice: number;
  /** Percent over the day. */
  readonly change24h: number;
  /** USD to move the price ±2%. */
  readonly liquidity: number;
}

function sqrtOf(read: PoolRead): number {
  return Number(read.sqrtPriceX96) / Q96;
}

/** USD per share. `stockIsToken0`: the stock sorts below USDG, so the pool prices USDG per stock. */
export function priceOf(read: PoolRead, stockIsToken0: boolean): number {
  const raw = sqrtOf(read) ** 2;
  const perToken = stockIsToken0 ? raw * DECIMALS_SHIFT : DECIMALS_SHIFT / raw;
  return perToken / (Number(read.multiplier) / ONE);
}

/**
 * USD it takes to move the price DEPTH_BAND up and down: the USDG out on the way down plus the stock out on the way
 * up, at the current in-range liquidity. Both legs come to `L·√P·(1 − 1/√(1+b))` in token1, so the sum is twice that.
 */
export function depthOf(read: PoolRead, stockIsToken0: boolean): number {
  const sqrt = sqrtOf(read);
  const leg = 1 - 1 / Math.sqrt(1 + DEPTH_BAND);
  const L = Number(read.liquidity);
  // In USDG's raw units: token1 when the stock is token0, else token0.
  const usdgRaw = stockIsToken0 ? 2 * L * sqrt * leg : (2 * L * leg) / sqrt;
  return usdgRaw / 1e6;
}

const cents = (value: number): number => Math.round(value * 100) / 100;

/**
 * A stock's quote from the day's samples, oldest first, ending with now (a sample is null when the pool had no state
 * at that block). Null when there is no read now.
 */
export function quoteOf(samples: readonly (PoolRead | null)[], stockIsToken0: boolean): StockQuote | null {
  const now = samples.at(-1);
  if (!now || now.sqrtPriceX96 === 0n) return null;
  const prices = samples.filter((s): s is PoolRead => s !== null && s.sqrtPriceX96 !== 0n).map((s) => priceOf(s, stockIsToken0));
  const price = priceOf(now, stockIsToken0);
  const open = prices[0] ?? price;
  return {
    price: cents(price),
    avgPrice: cents(prices.reduce((sum, p) => sum + p, 0) / prices.length),
    change24h: cents((price / open - 1) * 100),
    liquidity: Math.round(depthOf(now, stockIsToken0)),
  };
}
