// Reads `deployments/sepolia.json`, so no app hard-codes an address. `ens` holds ENS's contracts (each with the source
// it was read from); `contracts` holds ours, each with its deploy block, transaction and verification.

import { type Address, type Hex, getAddress } from 'viem';

import sepolia from '../../../../deployments/sepolia.json' with { type: 'json' };

/** An ENSv2 contract we call, with where its address and source come from. */
export interface EnsContract {
  address: Address;
  source: string;
}

/** A contract we deployed. */
export interface OurContract {
  address: Address;
  deployBlock: number;
  txHash: Hex;
  verified: boolean;
}

export type EnsName =
  | 'UniversalResolver'
  | 'RootRegistry'
  | 'ETHRegistry'
  | 'ETHRegistrar'
  | 'VerifiableFactory'
  | 'VerifiableProxyLogic'
  | 'UserRegistryImpl'
  | 'PermissionedResolverImpl';

export type ContractName =
  | 'GameBoxNames'
  | 'PlayerStats'
  | 'BoxResults'
  | 'DemoLicences'
  | 'DemoBoxAccount'
  | (string & {});

interface DeploymentsFile {
  chainId: number;
  ens: Record<EnsName, EnsContract>;
  contracts: Record<string, OurContract>;
}

const file = sepolia as unknown as DeploymentsFile;

/** The chain every address in the file is on (Sepolia). */
export const chainId: number = file.chainId;

/** An ENSv2 contract's address. */
export function ensAddress(name: EnsName): Address {
  return getAddress(file.ens[name].address);
}

/** One of our contracts, or `undefined` before it is deployed. */
export function ourContract(name: ContractName): OurContract | undefined {
  const entry = file.contracts[name];
  return entry && { ...entry, address: getAddress(entry.address) };
}

/** One of our contracts' addresses. Throws if it is not deployed yet. */
export function contractAddress(name: ContractName): Address {
  const entry = ourContract(name);
  if (!entry) throw new Error(`${name} is not in deployments/sepolia.json`);
  return entry.address;
}
