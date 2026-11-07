// `pnpm market:discover`: finds each stock's deepest Uniswap pool against USDG on Robinhood Chain and writes it into
// deployments/robinhood.json. A stock's token is checked first: it must be a BeaconProxy on Robinhood's stock-token
// beacon. The candidates are the v3 factory's pool at each fee tier and the hookless v4 pools at the usual fee and
// tick-spacing pairs; the one with the most in-range liquidity wins (liquidity is in the same units for one pair).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Address, type Hex, encodeAbiParameters, getAddress, keccak256, parseAbi, zeroAddress } from 'viem';

import {
  type StockPool,
  readPools,
  robinhoodAddress,
  robinhoodClient,
  stockListings,
} from '../../src/market/index.ts';
import { run } from '../names/env.ts';

const FILE = fileURLToPath(new URL('../../../../deployments/robinhood.json', import.meta.url));
const V3_FEES = [100, 500, 3000, 10_000];
const V4_FEES = [100, 500, 1000, 2400, 2500, 3000, 5000, 8000, 10_000];
const V4_SPACINGS = [1, 10, 50, 60, 100, 200];
/** EIP-1967's beacon slot. */
const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';

const factoryAbi = parseAbi(['function getPool(address, address, uint24) view returns (address)']);

function v4Id(currency0: Address, currency1: Address, fee: number, tickSpacing: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [currency0, currency1, fee, tickSpacing, zeroAddress],
    ),
  );
}

function rpcUrl(): string {
  const url = process.env.ROBINHOOD_RPC_URL;
  if (!url) throw new Error('ROBINHOOD_RPC_URL is not set (see .env.example)');
  return url;
}

run(async () => {
  const client = robinhoodClient(rpcUrl());
  const usdg = robinhoodAddress('USDG');
  const beacon = robinhoodAddress('StockTokenBeacon');
  const head = await client.getBlockNumber();
  const file = JSON.parse(readFileSync(FILE, 'utf8')) as { stocks: Record<string, { token: string; pool: unknown }> };
  let ok = true;

  for (const listing of stockListings()) {
    const slot = await client.getStorageAt({ address: listing.token, slot: BEACON_SLOT });
    if (!slot || getAddress(`0x${slot.slice(-40)}`) !== beacon) {
      console.error(`${listing.ticker}: ${listing.token} is not a Robinhood stock token`);
      ok = false;
      continue;
    }
    const [currency0, currency1] = listing.token.toLowerCase() < usdg.toLowerCase() ? [listing.token, usdg] : [usdg, listing.token];
    const v3 = await client.multicall({
      contracts: V3_FEES.map((fee) => ({ address: robinhoodAddress('UniswapV3Factory'), abi: factoryAbi, functionName: 'getPool', args: [listing.token, usdg, fee] }) as const),
      allowFailure: false,
    });
    const candidates: StockPool[] = [
      ...V3_FEES.flatMap((fee, i): StockPool[] => (v3[i] && v3[i] !== zeroAddress ? [{ version: 3, address: v3[i], fee }] : [])),
      ...V4_FEES.flatMap((fee) =>
        V4_SPACINGS.map((tickSpacing): StockPool => ({ version: 4, id: v4Id(currency0, currency1, fee, tickSpacing), fee, tickSpacing, hooks: zeroAddress })),
      ),
    ];
    const reads = await readPools(client, candidates.map((pool) => ({ ...listing, pool })), head, true);
    let best: { pool: StockPool; liquidity: bigint } | null = null;
    reads.forEach((read, i) => {
      const pool = candidates[i];
      if (!read || !pool || read.sqrtPriceX96 === 0n || read.liquidity === 0n) return;
      if (!best || read.liquidity > best.liquidity) best = { pool, liquidity: read.liquidity };
    });
    const found = best as { pool: StockPool; liquidity: bigint } | null;
    if (!found) {
      console.error(`${listing.ticker}: no USDG pool with liquidity`);
      ok = false;
      continue;
    }
    const entry = file.stocks[listing.ticker];
    if (entry) entry.pool = found.pool;
    const where = found.pool.version === 3 ? found.pool.address : `${found.pool.id} (${found.pool.tickSpacing})`;
    console.log(`${listing.ticker.padEnd(6)} v${found.pool.version} ${String(found.pool.fee).padStart(5)} ${where}`);
  }

  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`wrote ${FILE} at block ${head}`);
  return ok;
});
