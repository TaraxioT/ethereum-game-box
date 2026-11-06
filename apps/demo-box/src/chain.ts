// What the demo Box reads from Sepolia: its Boxes, recent pop-ups, and the rounds already settled.

import { boxResultsAbi, demoLicencesAbi, gameBoxNamesAbi } from '@egb/shared/names';
import { type Address, type PublicClient, createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

export interface BoxInfo {
  account: Address;
  resolver: Address;
  /** Unix seconds. */
  expiry: number;
  /** `GameBoxNames.BoxStatus`: 0 none, 1 active, 2 suspended, 3 revoked. */
  status: number;
}

export interface BoxChain {
  box(label: string): Promise<BoxInfo>;
  roundUsed(box: string, round: bigint): Promise<boolean>;
  /** The labels of the pop-ups opened in the last half hour (live or not). */
  recentPopups(): Promise<string[]>;
}

export interface Contracts {
  names: Address;
  results: Address;
  licences: Address;
}

/** About half an hour of Sepolia blocks: every pop-up opened in it has a 10-minute licence. */
const POPUP_LOOKBACK = 150n;

export function sepoliaChain(rpcUrl: string, contracts: Contracts): BoxChain {
  const client: PublicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { retryCount: 1 }) });
  return {
    async box(label) {
      const box = await client.readContract({
        address: contracts.names,
        abi: gameBoxNamesAbi,
        functionName: 'getBox',
        args: [label],
      });
      return { account: box.account, resolver: box.resolver, expiry: Number(box.expiry), status: box.status };
    },
    roundUsed(box, round) {
      return client.readContract({
        address: contracts.results,
        abi: boxResultsAbi,
        functionName: 'roundUsed',
        args: [box, round],
      });
    },
    async recentPopups() {
      const head = await client.getBlockNumber();
      const events = await client.getContractEvents({
        address: contracts.licences,
        abi: demoLicencesAbi,
        eventName: 'PopupOpened',
        fromBlock: head > POPUP_LOOKBACK ? head - POPUP_LOOKBACK : 0n,
        toBlock: head,
      });
      return [...new Set(events.map((event) => event.args.boxLabel).filter((label) => label !== undefined))];
    },
  };
}
