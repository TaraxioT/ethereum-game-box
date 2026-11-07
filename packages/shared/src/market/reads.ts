// Robinhood Chain reads: a client over ROBINHOOD_RPC_URL, and every listed pool's state at a block in one multicall.
// The RPC URL carries the node's key: callers redact errors before they print them.

import { type Address, type PublicClient, createPublicClient, defineChain, getAddress, http, parseAbi } from 'viem';

import { type StockListing, ROBINHOOD_CHAIN_ID, robinhoodAddress } from './deployments.ts';
import type { PoolRead } from './stats.ts';

export const v3PoolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
]);
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128)',
]);
export const stockTokenAbi = parseAbi(['function uiMultiplier() view returns (uint256)']);

export function robinhoodClient(rpcUrl: string): PublicClient {
  const chain = defineChain({
    id: ROBINHOOD_CHAIN_ID,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    contracts: { multicall3: { address: robinhoodAddress('Multicall3') } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 15_000 }) });
}

/** Whether the stock sorts below USDG, so it is the pool's token0. */
export function stockIsToken0(token: Address): boolean {
  return getAddress(token).toLowerCase() < robinhoodAddress('USDG').toLowerCase();
}

type Listed = StockListing & { readonly pool: NonNullable<StockListing['pool']> };

/** The listings with a pool; throws if any has none (run `pnpm market:discover`). */
export function pooled(listings: readonly StockListing[]): readonly Listed[] {
  const missing = listings.filter((l) => l.pool === null).map((l) => l.ticker);
  if (missing.length > 0) throw new Error(`no pool for ${missing.join(', ')}: run pnpm market:discover`);
  return listings as readonly Listed[];
}

/**
 * Each listing's pool at `block`, in listing order: null where a read failed (the pool or token didn't exist yet).
 * `withLiquidity` also reads the in-range liquidity (only the latest sample needs it).
 */
export async function readPools(
  client: PublicClient,
  listings: readonly Listed[],
  block: bigint,
  withLiquidity: boolean,
): Promise<(PoolRead | null)[]> {
  const stateView = robinhoodAddress('StateView');
  const calls = listings.flatMap((listing) => {
    const { pool } = listing;
    const slot =
      pool.version === 3
        ? ({ address: pool.address, abi: v3PoolAbi, functionName: 'slot0' } as const)
        : ({ address: stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [pool.id] } as const);
    const liquidity =
      pool.version === 3
        ? ({ address: pool.address, abi: v3PoolAbi, functionName: 'liquidity' } as const)
        : ({ address: stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [pool.id] } as const);
    const multiplier = { address: listing.token, abi: stockTokenAbi, functionName: 'uiMultiplier' } as const;
    return withLiquidity ? [slot, multiplier, liquidity] : [slot, multiplier];
  });
  const results = await client.multicall({ contracts: calls, blockNumber: block, allowFailure: true });
  const per = withLiquidity ? 3 : 2;
  return listings.map((_, i) => {
    const [slot, multiplier, liquidity] = results.slice(i * per, i * per + per);
    if (slot?.status !== 'success' || multiplier?.status !== 'success') return null;
    if (withLiquidity && liquidity?.status !== 'success') return null;
    const sqrtPriceX96 = (slot.result as readonly [bigint, ...unknown[]])[0];
    return {
      sqrtPriceX96,
      multiplier: multiplier.result as bigint,
      liquidity: withLiquidity ? (liquidity?.result as bigint) : 0n,
    };
  });
}
