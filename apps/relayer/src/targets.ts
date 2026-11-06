// The contracts in `deployments/sepolia.json`: ours, ENS's, and the proxies `GameBoxNames` created. An account may have
// the relayer call any of them (the external tokens are not ours, and are left out).

import { type Address, getAddress, isAddress } from 'viem';

import sepolia from '../../../deployments/sepolia.json' with { type: 'json' };

function addressesIn(value: unknown): Address[] {
  if (typeof value === 'string') return isAddress(value, { strict: false }) ? [getAddress(value)] : [];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(addressesIn);
  return [];
}

/** Every address under `contracts`, `ens` and `names`, lower-cased. */
export function deployedTargets(): Set<string> {
  const { contracts, ens, names } = sepolia as { contracts?: unknown; ens?: unknown; names?: unknown };
  return new Set(addressesIn([contracts, ens, names]).map((address) => address.toLowerCase()));
}
