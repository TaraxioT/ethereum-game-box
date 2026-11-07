// Reads `deployments/robinhood.json`: the Robinhood Chain mainnet contracts Stock Duel reads (never writes), and each
// deck stock's token with the Uniswap pool against USDG its numbers come from. `pnpm market:discover` writes the pools.

import { type Address, type Hex, getAddress, isAddress, isHex } from 'viem';

import robinhood from '../../../../deployments/robinhood.json' with { type: 'json' };

export type RobinhoodContract = 'USDG' | 'StockTokenBeacon' | 'UniswapV3Factory' | 'StateView' | 'Multicall3';

/** A stock's pool against USDG: a v3 pool contract, or a v4 pool (an id in the PoolManager, read through StateView). */
export type StockPool =
  | { readonly version: 3; readonly address: Address; readonly fee: number }
  | { readonly version: 4; readonly id: Hex; readonly fee: number; readonly tickSpacing: number; readonly hooks: Address };

export interface StockListing {
  readonly ticker: string;
  readonly token: Address;
  /** null until `pnpm market:discover` has found it. */
  readonly pool: StockPool | null;
}

export const ROBINHOOD_CHAIN_ID: number = robinhood.chainId;

const external: Readonly<Record<string, string>> = robinhood.external;

export function robinhoodAddress(name: RobinhoodContract): Address {
  const address = external[name];
  if (!address || !isAddress(address, { strict: false })) throw new Error(`deployments/robinhood.json has no ${name}`);
  return getAddress(address);
}

function poolOf(ticker: string, raw: unknown): StockPool | null {
  if (raw === null) return null;
  const pool = raw as Record<string, unknown>;
  const fee = Number(pool.fee);
  if (pool.version === 3 && typeof pool.address === 'string' && isAddress(pool.address, { strict: false })) {
    return { version: 3, address: getAddress(pool.address), fee };
  }
  if (
    pool.version === 4 &&
    typeof pool.id === 'string' &&
    isHex(pool.id) &&
    pool.id.length === 66 &&
    typeof pool.hooks === 'string' &&
    isAddress(pool.hooks, { strict: false })
  ) {
    return { version: 4, id: pool.id, fee, tickSpacing: Number(pool.tickSpacing), hooks: getAddress(pool.hooks) };
  }
  throw new Error(`deployments/robinhood.json: ${ticker} has a malformed pool`);
}

/** Every stock in the file, in its order. */
export function stockListings(): readonly StockListing[] {
  return Object.entries(robinhood.stocks as Record<string, { token: string; pool: unknown }>).map(([ticker, entry]) => {
    if (!isAddress(entry.token, { strict: false })) throw new Error(`deployments/robinhood.json: ${ticker} has a malformed token`);
    return { ticker, token: getAddress(entry.token), pool: poolOf(ticker, entry.pool) };
  });
}
