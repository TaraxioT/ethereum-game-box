// What the demo Box and its agent read from Sepolia: Boxes, text records, used rounds, open championships, and accounts
// and names.

import {
  boxResultsAbi,
  championshipsAbi,
  duelPotAbi,
  fullName,
  gameBoxNamesAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  resolverProfilesAbi,
} from '@egb/shared/names';
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  namehash,
  toHex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';

export interface BoxInfo {
  account: Address;
  resolver: Address;
  /** Unix seconds. */
  expiry: number;
  /** `GameBoxNames.BoxStatus`: 0 none, 1 active, 2 suspended, 3 revoked. */
  status: number;
}

/** The reads the demo Box makes. */
export interface BoxChain {
  box(label: string): Promise<BoxInfo>;
  /** A text record of `<label>.gamebox.eth`, read from its own resolver (which answers only through ENSIP-10
   *  `resolve`). Reads cost nothing, so the Box reads a record before it writes it. */
  text(resolver: Address, label: string, key: string): Promise<string>;
  /** Whether `(box, round)` has a result in `BoxResults` or a pot in `DuelPot`: a round is used once, for both. */
  roundTaken(box: string, round: bigint): Promise<boolean>;
  /** The game's open championship, or `null`. */
  openCup(game: string): Promise<{ label: string; ends: number } | null>;
}

/** The reads the agent makes, on top of the text records. */
export interface AgentChain extends Pick<BoxChain, 'text'> {
  /** `P256AccountFactory.accountOf`: the account of a key, deployed or not. */
  accountOf(qx: Hex, qy: Hex): Promise<Address>;
  deployed(account: Address): Promise<boolean>;
  /** `GameBoxNames.nameOf`: the player name an address holds, or `''`. */
  nameOf(account: Address): Promise<string>;
  /** The resolver `<label>.gamebox.eth` has in `gamebox.eth`'s registry. */
  resolverOf(label: string): Promise<Address>;
}

export interface Contracts {
  names: Address;
  results: Address;
  pot: Address;
  cups: Address;
  factory: Address;
  /** `gamebox.eth`'s own registry. */
  registry: Address;
}

export function sepoliaChain(rpcUrl: string, contracts: Contracts): BoxChain & AgentChain {
  const client: PublicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 1 }) });
  const names = { address: contracts.names, abi: gameBoxNamesAbi } as const;
  return {
    async box(label) {
      const box = await client.readContract({ ...names, functionName: 'getBox', args: [label] });
      return { account: box.account, resolver: box.resolver, expiry: Number(box.expiry), status: box.status };
    },
    async text(resolver, label, key) {
      const name = fullName(label);
      const call = { abi: resolverProfilesAbi, functionName: 'text' } as const;
      const answer = await client.readContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: 'resolve',
        args: [toHex(packetToBytes(name)), encodeFunctionData({ ...call, args: [namehash(name), key] })],
      });
      return decodeFunctionResult({ ...call, data: answer });
    },
    async roundTaken(box, round) {
      const [used, pot] = await Promise.all([
        client.readContract({ address: contracts.results, abi: boxResultsAbi, functionName: 'roundUsed', args: [box, round] }),
        client.readContract({ address: contracts.pot, abi: duelPotAbi, functionName: 'getPot', args: [box, round] }),
      ]);
      return used || pot.state !== 0;
    },
    async openCup(game) {
      const cups = { address: contracts.cups, abi: championshipsAbi } as const;
      const id = await client.readContract({ ...cups, functionName: 'openCup', args: [game] });
      if (id === 0n) return null;
      const cup = await client.readContract({ ...cups, functionName: 'getCup', args: [id] });
      return { label: cup.label, ends: Number(cup.ends) };
    },
    accountOf(qx, qy) {
      return client.readContract({
        address: contracts.factory,
        abi: p256AccountFactoryAbi,
        functionName: 'accountOf',
        args: [qx, qy],
      });
    },
    async deployed(account) {
      const code = await client.getCode({ address: account });
      return code !== undefined && code !== '0x';
    },
    nameOf(account) {
      return client.readContract({ ...names, functionName: 'nameOf', args: [account] });
    },
    resolverOf(label) {
      return client.readContract({
        address: contracts.registry,
        abi: permissionedRegistryAbi,
        functionName: 'getResolver',
        args: [label],
      });
    },
  };
}
