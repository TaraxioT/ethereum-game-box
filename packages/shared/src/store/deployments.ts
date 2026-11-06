// `StorePot` and Store USDC in `deployments/sepolia.json`. Each is `undefined` until it is deployed, so nothing that
// imports this breaks before then: a caller with no pot simply has no store games.

import type { Address } from 'viem';

import { ourContract } from '../names/deployments.ts';

/** `StorePot`'s address, or `undefined` before it is deployed. */
export function storePotAddress(): Address | undefined {
  return ourContract('StorePot')?.address;
}

/** Store USDC's address, or `undefined` before it is deployed. */
export function storeUsdcAddress(): Address | undefined {
  return ourContract('StoreUSDC')?.address;
}
