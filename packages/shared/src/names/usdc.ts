// The demo's test USDC (`FakeUSDC` in `deployments/sepolia.json`): 6 decimals, like USDC. It is the only USDC the
// project uses, and has no value. Stakes, top-ups and prizes are in its base units.

import { formatUnits, parseUnits } from 'viem';

export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = 'USDC';

/** Whole (or decimal) USDC to base units: `usdc(10)` is `10_000_000n`. */
export function usdc(amount: number | string): bigint {
  return parseUnits(String(amount), USDC_DECIMALS);
}

/** Base units to a USDC amount for people, without trailing zeros: `formatUsdc(20_000_000n)` is `'20'`. */
export function formatUsdc(base: bigint): string {
  return formatUnits(base, USDC_DECIMALS);
}
