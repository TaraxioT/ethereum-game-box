// What the chain says: the only thing a scenario believes. Balances, pots and events, read straight from anvil.

import { fakeUsdcAbi } from '@egb/shared/names';
import { storePotAbi } from '@egb/shared/store';
import { type Address, type Hex, formatUnits } from 'viem';

import type { Chain } from './anvil.ts';
import type { Contracts } from './contracts.ts';

/** `IStorePot.State`. */
export const STATE = { none: 0, open: 1, settled: 2, voided: 3, refunded: 4 } as const;

const USDC_DECIMALS = 6;

export interface Transfer {
  readonly to: Address;
  readonly value: bigint;
}

/** One USDC, in base units. */
export const usdc = (whole: number) => BigInt(whole) * 10n ** BigInt(USDC_DECIMALS);

export const showUsdc = (amount: bigint) => formatUnits(amount, USDC_DECIMALS);

export function ledger({ client }: Chain, { pot, usdc: token }: Contracts, box: string) {
  const potContract = { address: pot, abi: storePotAbi } as const;
  const tokenContract = { address: token, abi: fakeUsdcAbi } as const;
  const fromStart = { fromBlock: 0n, toBlock: 'latest' } as const;

  const events = {
    listed: async (bundle: Hex) => client.getContractEvents({ ...potContract, eventName: 'BundleListed', args: { bundle }, ...fromStart }),
    opened: async (round: bigint) => client.getContractEvents({ ...potContract, eventName: 'PotOpened', args: { round }, ...fromStart }),
    allOpened: async () => client.getContractEvents({ ...potContract, eventName: 'PotOpened', ...fromStart }),
    settled: async (round: bigint) => client.getContractEvents({ ...potContract, eventName: 'PotSettled', args: { round }, ...fromStart }),
    voided: async (round: bigint) => client.getContractEvents({ ...potContract, eventName: 'PotVoided', args: { round }, ...fromStart }),
    refunded: async (round: bigint) => client.getContractEvents({ ...potContract, eventName: 'PotRefunded', args: { round }, ...fromStart }),
  };

  return {
    events,
    balances: (addresses: readonly Address[]) =>
      Promise.all(addresses.map((address) => client.readContract({ ...tokenContract, functionName: 'balanceOf', args: [address] }))),
    potBalance: () => client.readContract({ ...tokenContract, functionName: 'balanceOf', args: [pot] }),
    pot: (round: bigint) => client.readContract({ ...potContract, functionName: 'getPot', args: [box, round] }),
    listed: (bundle: Hex) => client.readContract({ ...potContract, functionName: 'listed', args: [bundle] }),
    /** Every Store USDC transfer out of the pot in the transaction `hash`. */
    async paidOut(hash: Hex): Promise<Transfer[]> {
      const { blockHash } = await client.getTransactionReceipt({ hash });
      const logs = await client.getContractEvents({ ...tokenContract, eventName: 'Transfer', args: { from: pot }, blockHash });
      return logs.filter(({ transactionHash }) => transactionHash === hash).map(({ args }) => ({ to: args.to as Address, value: args.value as bigint }));
    },
  };
}

export type Ledger = ReturnType<typeof ledger>;
