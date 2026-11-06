// Whether a stake's pot is open. Anyone may send a Box's signed stake (`StorePot.open` doesn't look at its caller), so a
// copy of the relayer's transaction can mine first: the relayer's own transaction then reverts, and the pot is open all
// the same, holding the players' stakes. The sender reads this before it calls a stake failed, or the Box would drop a
// round that needs a match or a refund.

import { storePotAbi } from '@egb/shared/names';
import type { StoreStake } from '@egb/shared/store';
import { type Address, isAddressEqual } from 'viem';

import type { Client } from './chain.ts';

/** `IStorePot.State.Open`. */
const OPEN = 1;

/** A stake, and the `StorePot` it opens a pot in. */
export interface Opens {
  pot: Address;
  stake: StoreStake;
}

/** Whether its round has an open pot at `blockNumber`, and it is this stake's: a Box signs one stake a round. */
export async function stakeIsOpen(client: Client, { pot, stake }: Opens, blockNumber: bigint): Promise<boolean> {
  const { box, round, bundle, players, amount } = stake;
  const entry = await client.readContract({ address: pot, abi: storePotAbi, functionName: 'getPot', args: [box, round], blockNumber });
  return (
    entry.state === OPEN &&
    entry.bundle === bundle &&
    entry.amount === amount &&
    entry.players.length === players.length &&
    entry.players.every((player, i) => isAddressEqual(player, players[i]!))
  );
}
