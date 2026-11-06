// `pnpm names:verify`: verifies every contract of the names deployment on Etherscan, and marks ours `verified` in
// `deployments/sepolia.json`. Run it after every deploy and whenever new names were claimed; it skips what is done.
//
// - Our contracts: `forge verify-contract`, with the constructor arguments read from the creation transaction.
// - The proxy logic every `VerifiableFactory` proxy clones: if it is unverified, it is verified from the source ENS
//   deployed it with (the `VerifiableFactory` deployment's metadata). Once it is, Etherscan shows the source of every
//   proxy (each is a 77-byte clone of it).
// - Every proxy (`gamebox.eth`'s registry, the shared resolvers, each title registry, and one resolver per Box licence
//   and per player): `verifyproxycontract`, linked to the ERC-1967 implementation `VerifiableFactory.verifyContract`
//   reports.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Address } from 'viem';

import { verifiableFactoryAbi } from '../../src/names/abis.ts';
import { ensAddress, ourContract } from '../../src/names/deployments.ts';
import { discover } from './discover.ts';
import { redact, run, sepoliaClient } from './env.ts';
import { sourceInfo, verifyProxy, verifyStandardJson } from './etherscan.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const deploymentsPath = `${root}deployments/sepolia.json`;

/** Our contracts, by their name in `deployments/sepolia.json`, and their source. */
const OURS: Record<string, string> = {
  GameBoxNames: 'src/names/GameBoxNames.sol:GameBoxNames',
  PlayerStats: 'src/names/PlayerStats.sol:PlayerStats',
  BoxResults: 'src/names/BoxResults.sol:BoxResults',
  DemoLicences: 'src/names/DemoLicences.sol:DemoLicences',
  DemoBoxAccount: 'src/box/BoxAccount.sol:BoxAccount',
};

async function verifyOurs(): Promise<boolean> {
  const file = JSON.parse(readFileSync(deploymentsPath, 'utf8')) as {
    contracts: Record<string, { address: Address; verified: boolean }>;
  };
  let ok = true;
  for (const [name, source] of Object.entries(OURS)) {
    const entry = ourContract(name);
    if (!entry) continue;
    if (!(await sourceInfo(entry.address)).ContractName) {
      console.log(`${name}: forge verify-contract`);
      try {
        execFileSync(
          'forge',
          [
            'verify-contract',
            entry.address,
            source,
            '--chain',
            'sepolia',
            '--rpc-url',
            process.env.SEPOLIA_RPC_URL ?? '',
            '--guess-constructor-args',
            '--watch',
          ],
          { cwd: `${root}contracts`, stdio: 'pipe' },
        );
      } catch (error) {
        console.log(redact(String((error as { stderr?: Buffer }).stderr ?? error)));
      }
    }
    const verified = Boolean((await sourceInfo(entry.address)).ContractName);
    console.log(`${verified ? 'ok  ' : 'FAIL'} ${name} ${entry.address}`);
    ok &&= verified;
    file.contracts[name]!.verified = verified;
  }
  writeFileSync(deploymentsPath, `${JSON.stringify(file, null, 2)}\n`);
  return ok;
}

/** Verifies `UUPSProxyLogic` from the metadata of ENS's `VerifiableFactory` deployment, which embeds its sources. */
async function verifyProxyLogic(): Promise<boolean> {
  const logic = ensAddress('VerifiableProxyLogic');
  if ((await sourceInfo(logic)).ContractName) {
    console.log(`ok   proxy logic ${logic}`);
    return true;
  }
  const file = JSON.parse(readFileSync(deploymentsPath, 'utf8')) as { ens: { VerifiableFactory: { source: string } } };
  const factoryJson = file.ens.VerifiableFactory.source
    .replace('github.com', 'raw.githubusercontent.com')
    .replace('/blob/', '/');
  const deployment = (await (await fetch(factoryJson)).json()) as { metadata: string };
  const metadata = JSON.parse(deployment.metadata) as {
    compiler: { version: string };
    sources: Record<string, { content: string }>;
    settings: { optimizer: unknown; evmVersion: string; remappings: string[]; metadata: unknown };
  };
  const input = {
    language: 'Solidity',
    sources: Object.fromEntries(Object.entries(metadata.sources).map(([path, s]) => [path, { content: s.content }])),
    settings: {
      optimizer: metadata.settings.optimizer,
      evmVersion: metadata.settings.evmVersion,
      remappings: metadata.settings.remappings,
      metadata: metadata.settings.metadata,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'metadata'] } },
    },
  };
  const target = Object.keys(metadata.sources).find((path) => path.endsWith('/UUPSProxyLogic.sol'))!;
  const answer = await verifyStandardJson(logic, input, `${target}:UUPSProxyLogic`, `v${metadata.compiler.version}`);
  console.log(`proxy logic ${logic}: ${answer}`);
  return /pass|already verified/i.test(answer);
}

async function verifyProxies(): Promise<boolean> {
  const client = sepoliaClient();
  const factory = ensAddress('VerifiableFactory');
  const { proxies } = await discover(client);
  let ok = true;
  for (const { address, what } of proxies) {
    const implementation = await client.readContract({
      address: factory,
      abi: verifiableFactoryAbi,
      functionName: 'verifyContract',
      args: [address],
    });
    const answer = await verifyProxy(address, implementation);
    const linked = /successfully updated|already verified/i.test(answer);
    const info = await sourceInfo(address);
    const shown = linked && info.ContractName !== '' && info.Proxy !== '0';
    console.log(`${shown ? 'ok  ' : 'FAIL'} ${what} ${address} -> ${implementation}: ${answer}`);
    ok &&= shown;
  }
  return ok;
}

run(async () => {
  const ours = await verifyOurs();
  const logic = await verifyProxyLogic();
  const proxies = await verifyProxies();
  return ours && logic && proxies;
});
