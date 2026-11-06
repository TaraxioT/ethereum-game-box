// Finds every name `GameBoxNames` has made, from its events (read in chunks from its deploy block), and every proxy
// behind them: the fixed ones in `deployments/sepolia.json` and one resolver per Box licence and per player.

import { type Address, type PublicClient, getAbiItem } from 'viem';

import { gameBoxNamesAbi } from '../../src/names/abis.ts';
import { contractAddress, namesProxies, ourContract } from '../../src/names/deployments.ts';

const CHUNK = 5_000n;

export interface BoxLicence {
  label: string;
  operator: Address;
  account: Address;
  resolver: Address;
}

export interface PlayerName {
  label: string;
  badge: Address;
  resolver: Address;
}

export interface Discovered {
  boxes: BoxLicence[];
  players: PlayerName[];
  /** Every factory proxy, with what it is. */
  proxies: { address: Address; what: string }[];
}

export async function discover(client: PublicClient): Promise<Discovered> {
  const names = contractAddress('GameBoxNames');
  const from = BigInt(ourContract('GameBoxNames')!.deployBlock);
  const head = await client.getBlockNumber();
  const boxes: BoxLicence[] = [];
  const players: PlayerName[] = [];
  for (let start = from; start <= head; start += CHUNK) {
    const toBlock = start + CHUNK - 1n > head ? head : start + CHUNK - 1n;
    const logs = await client.getLogs({
      address: names,
      events: [
        getAbiItem({ abi: gameBoxNamesAbi, name: 'BoxRegistered' }),
        getAbiItem({ abi: gameBoxNamesAbi, name: 'PlayerClaimed' }),
      ],
      fromBlock: start,
      toBlock,
    });
    for (const log of logs) {
      if (log.eventName === 'BoxRegistered') {
        const { label, operator, account, resolver } = log.args;
        boxes.push({ label: label!, operator: operator!, account: account!, resolver: resolver! });
      } else {
        const { label, badge, resolver } = log.args;
        players.push({ label: label!, badge: badge!, resolver: resolver! });
      }
    }
  }

  const fixed = namesProxies();
  const proxies = [
    { address: fixed.registry, what: 'gamebox.eth registry' },
    { address: fixed.titleResolver, what: 'title resolver' },
    { address: fixed.gameResolver, what: 'game resolver' },
    ...Object.entries(fixed.titles).map(([game, address]) => ({ address, what: `${game} title registry` })),
    ...boxes.map((b) => ({ address: b.resolver, what: `${b.label} resolver` })),
    ...players.map((p) => ({ address: p.resolver, what: `${p.label} resolver` })),
  ];
  return { boxes, players, proxies };
}

/** The latest licence per label: a label re-registered after a lapse has a new resolver. */
export function currentBoxes(boxes: BoxLicence[]): BoxLicence[] {
  return [...new Map(boxes.map((b) => [b.label, b])).values()];
}
