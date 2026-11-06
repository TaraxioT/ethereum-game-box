// Reads `deployments/sepolia.json`, so no app hard-codes an address. `ens` holds ENS's contracts (each with the source
// it was read from); `contracts` holds ours, each with its deploy block, transaction and verification; `names` holds
// the proxies `GameBoxNames` created (its registry, the shared resolvers and the title registries) and `gamebox.eth`'s
// own resolver.

import { type Address, type Hex, getAddress, isAddress } from 'viem';

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
  | 'UniversalHelper'
  | 'RootRegistry'
  | 'ETHRegistry'
  | 'ETHRegistrar'
  | 'VerifiableFactory'
  | 'VerifiableProxyLogic'
  | 'UserRegistryImpl'
  | 'PermissionedResolverImpl'
  | 'DefaultReverseRegistrar'
  | 'ReverseRegistrar';

export type ContractName =
  | 'P256AccountFactory'
  | 'GameBoxNames'
  | 'PlayerStats'
  | 'BoxResults'
  | 'DemoLicences'
  | 'DemoBoxAccount'
  | (string & {});

/** The proxies we created through ENS's `VerifiableFactory` and that never move. */
export interface NamesProxies {
  /** `gamebox.eth`'s own resolver: the default record every free `*.gamebox.eth` name resolves to (wildcard). */
  gameboxResolver: Address;
  /** `gamebox.eth`'s own `UserRegistry`. */
  registry: Address;
  /** The resolver of every champion title. */
  titleResolver: Address;
  /** The resolver of every game name. */
  gameResolver: Address;
  /** Each game's title registry, by game label. */
  titles: Record<string, Address>;
}

interface DeploymentsFile {
  chainId: number;
  ens: Record<EnsName, EnsContract>;
  contracts: Record<string, OurContract>;
  names?: NamesProxies;
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

/** The proxies `GameBoxNames` created. Throws before the deploy. */
export function namesProxies(): NamesProxies {
  if (!file.names) throw new Error('names is not in deployments/sepolia.json');
  return file.names;
}

function addressesIn(value: unknown): Address[] {
  if (typeof value === 'string') return isAddress(value, { strict: false }) ? [getAddress(value)] : [];
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(addressesIn);
  return [];
}

/** Every contract address in `deployments/sepolia.json`: ours (`contracts`), ENS's (`ens`) and the proxies
 *  `GameBoxNames` created (`names`), checksummed, once each. The external tokens (`external`) are not ours and are
 *  left out. */
export function deployedAddresses(): Address[] {
  return [...new Set(addressesIn([file.contracts, file.ens, file.names]))];
}
