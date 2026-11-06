// The contracts of a run, deployed from forge's own build and wired the way `DeployStorePot` wires them, on `StubNames`
// (see that contract). What the Box and the Workers read is `deployments/sepolia.json` with these addresses in it, as a
// file of the run's own: the real one is never touched.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { storePotAbi } from '@egb/shared/store';
import { type Abi, type Address, type Hex, createWalletClient, http, zeroAddress, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import type { Chain } from './anvil.ts';
import { foundryEnv } from './foundry.ts';
import type { RunKeys } from './keys.ts';
import { ROOT } from './paths.ts';

/** `IGameBoxNames.BoxStatus.Active`. */
const ACTIVE = 1;
/** A licence that outlasts any run: the year 2100. */
const FAR_FUTURE = 4_102_444_800n;
const DEPLOYMENTS = path.join(ROOT, 'deployments/sepolia.json');

export interface Contracts {
  readonly pot: Address;
  readonly usdc: Address;
  readonly names: Address;
  /** The run's `deployments/sepolia.json`. */
  readonly deployments: string;
}

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

type Role = 'LISTER_ROLE' | 'VERIFIER_ROLE' | 'DEFAULT_ADMIN_ROLE';

const artifact = (contract: string): Artifact =>
  JSON.parse(readFileSync(path.join(ROOT, `contracts/out/${contract}.sol/${contract}.json`), 'utf8')) as Artifact;

/** Builds the contracts. Forge skips what hasn't changed. */
export function buildContracts(): void {
  execFileSync('forge', ['build', '--root', 'contracts'], { cwd: ROOT, env: foundryEnv(), stdio: 'ignore' });
}

function writeDeployments(file: string, deployed: Record<string, Address>): void {
  const real = JSON.parse(readFileSync(DEPLOYMENTS, 'utf8')) as { contracts: Record<string, object> };
  const entries = Object.entries(deployed).map(([name, address]) => [name, { address, deployBlock: 0, txHash: zeroHash, verified: false }]);
  writeFileSync(file, JSON.stringify({ ...real, contracts: { ...real.contracts, ...Object.fromEntries(entries) } }, null, 2));
}

export async function deployContracts(chain: Chain, keys: RunKeys, box: { label: string; qx: Hex; qy: Hex }, file: string): Promise<Contracts> {
  const deployer = privateKeyToAccount(keys.relayer);
  const admin = privateKeyToAccount(keys.admin);
  const wallet = createWalletClient({ account: deployer, chain: sepolia, transport: http(chain.url) });
  const mined = (hash: Hex) => chain.client.waitForTransactionReceipt({ hash });

  const deploy = async (contract: string, args: readonly unknown[]): Promise<Address> => {
    const { abi, bytecode } = artifact(contract);
    const { contractAddress } = await mined(await wallet.deployContract({ abi, bytecode: bytecode.object, args }));
    if (!contractAddress) throw new Error(`${contract} wasn't deployed`);
    return contractAddress;
  };
  const write = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[]) => {
    const { status } = await mined(await wallet.writeContract({ address, abi, functionName, args }));
    if (status !== 'success') throw new Error(`${functionName} reverted`);
  };

  const names = await deploy('StubNames', []);
  const teamUsdc = await deploy('FakeUSDC', [deployer.address, deployer.address]);
  const usdc = await deploy('FakeUSDC', [deployer.address, deployer.address]);
  const pot = await deploy('StorePot', [names, usdc, deployer.address]);
  await write(usdc, artifact('FakeUSDC').abi, 'setGameSpender', [pot]);

  const role = (name: Role) => chain.client.readContract({ address: pot, abi: storePotAbi, functionName: name });
  const grant = async (name: Role, key: Hex) => write(pot, storePotAbi, 'grantRole', [await role(name), privateKeyToAccount(key).address]);
  await grant('LISTER_ROLE', keys.lister);
  await grant('VERIFIER_ROLE', keys.verifier);
  await grant('DEFAULT_ADMIN_ROLE', keys.admin);
  await write(pot, storePotAbi, 'renounceRole', [await role('DEFAULT_ADMIN_ROLE'), deployer.address]);

  await write(names, artifact('StubNames').abi, 'setBox', [
    box.label,
    { operator: admin.address, account: admin.address, qx: box.qx, qy: box.qy, status: ACTIVE, resolver: zeroAddress, expiry: FAR_FUTURE },
  ]);

  writeDeployments(file, { GameBoxNames: names, FakeUSDC: teamUsdc, StoreUSDC: usdc, StorePot: pot });
  return { pot, usdc, names, deployments: file };
}
