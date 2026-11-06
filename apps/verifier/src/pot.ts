// `StorePot`, as the verifier reads it. Nothing here sends: the relayer does.

import type { Client } from '@egb/relayer/chain';
import { storePotAbi, storePotAddress } from '@egb/shared/store';
import type { Address } from 'viem';

/** `IStorePot.State`. */
export const POT_STATE = { none: 0, open: 1, settled: 2, voided: 3, refunded: 4 } as const;

/** The pot's address. Throws the deployments' own message until it is deployed, which the guard turns into a 503. */
export function deployedPot(): Address {
  const pot = storePotAddress();
  if (!pot) throw new Error('StorePot is not in deployments/sepolia.json');
  return pot;
}

export const readPot = (client: Client, pot: Address, box: string, round: bigint) =>
  client.readContract({ address: pot, abi: storePotAbi, functionName: 'getPot', args: [box, round] });

export type Pot = Awaited<ReturnType<typeof readPot>>;
