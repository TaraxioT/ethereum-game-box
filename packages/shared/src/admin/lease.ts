// A Box's lease (`BoxLease`): read where it stands, and build the calls that stake GBX on it (approving first when the
// allowance is short), unstake it, or close one that ran out. The Box's own server reads it to decide whether it may
// host games, and sends the calls with the admin's key.

import { type Address, type Hex, type PublicClient, encodeFunctionData, erc20Abi, formatUnits, zeroAddress } from 'viem';

import { boxLeaseAbi, gameBoxNamesAbi } from '../names/abis.ts';
import { contractAddress } from '../names/deployments.ts';
import { CREATES_STORAGE_GAS } from '../names/gas.ts';
import { fullName, labelProblem } from '../names/labels.ts';
import { type AdminCall, AdminInputError } from './calls.ts';

/** `GameBoxNames.BoxStatus`, by name. */
export type BoxStanding = 'none' | 'active' | 'suspended' | 'revoked';
const STANDINGS: readonly BoxStanding[] = ['none', 'active', 'suspended', 'revoked'];

export interface Lease {
  operator: Address;
  /** GBX wei. */
  stake: bigint;
  /** Unix seconds. */
  start: number;
  end: number;
}

export interface LeaseView {
  label: string;
  /** `<label>.gamebox.eth`. */
  name: string;
  standing: BoxStanding;
  /** The name's expiry (unix seconds); 0 with no name. */
  expiry: number;
  /** The name's own ENS resolver (its `status` text and address); null with no name. */
  resolver: Address | null;
  /** The key the name is registered with; null with no name. */
  key: { qx: Hex; qy: Hex } | null;
  /** Null when nothing is staked. */
  lease: Lease | null;
  /** The block's timestamp (unix seconds). */
  now: number;
  /** GBX wei per hour. */
  ratePerHour: bigint;
  minHours: number;
  maxHours: number;
  /** The staker's GBX and what `BoxLease` may pull of it. */
  staker: { address: Address; gbx: bigint; allowance: bigint } | null;
}

/** Whether the Box may host: its name is Active and unexpired, and a lease runs. */
export function leaseOpen(view: LeaseView): boolean {
  return view.standing === 'active' && view.expiry > view.now && view.lease !== null && view.lease.end > view.now;
}

/** Seconds left on the lease (0 when none or run out). */
export function leaseLeft(view: LeaseView): number {
  return view.lease ? Math.max(0, view.lease.end - view.now) : 0;
}

export interface LeaseReads {
  view(label: string, staker?: Address): Promise<LeaseView>;
}

export function leaseReads(client: PublicClient): LeaseReads {
  const lease = { address: contractAddress('BoxLease'), abi: boxLeaseAbi } as const;
  const names = { address: contractAddress('GameBoxNames'), abi: gameBoxNamesAbi } as const;
  const gbx = { address: contractAddress('GBX'), abi: erc20Abi } as const;

  return {
    async view(label, staker) {
      const head = await client.getBlock();
      const at = { blockNumber: head.number };
      const [box, held, rate, min, max, balance, allowance] = await Promise.all([
        client.readContract({ ...names, functionName: 'getBox', args: [label], ...at }),
        client.readContract({ ...lease, functionName: 'leaseOf', args: [label], ...at }),
        client.readContract({ ...lease, functionName: 'RATE_PER_HOUR', ...at }),
        client.readContract({ ...lease, functionName: 'MIN_HOURS', ...at }),
        client.readContract({ ...lease, functionName: 'MAX_HOURS', ...at }),
        staker ? client.readContract({ ...gbx, functionName: 'balanceOf', args: [staker], ...at }) : 0n,
        staker ? client.readContract({ ...gbx, functionName: 'allowance', args: [staker, lease.address], ...at }) : 0n,
      ]);
      const standing = STANDINGS[box.status] ?? 'none';
      return {
        label,
        name: fullName(label),
        standing,
        expiry: Number(box.expiry),
        resolver: standing === 'none' ? null : box.resolver,
        key: standing === 'none' ? null : { qx: box.qx, qy: box.qy },
        lease: held.operator === zeroAddress
          ? null
          : { operator: held.operator, stake: held.stake, start: Number(held.start), end: Number(held.end) },
        now: Number(head.timestamp),
        ratePerHour: rate,
        minHours: Number(min),
        maxHours: Number(max),
        staker: staker ? { address: staker, gbx: balance, allowance } : null,
      };
    },
  };
}

/** Stakes `hours` on the Box with key `(qx, qy)`: approves `BoxLease` first when the staker's allowance is short. */
export function stakeCalls(view: LeaseView, key: { qx: Hex; qy: Hex }, hours: number): AdminCall[] {
  if (labelProblem(view.label)) throw new AdminInputError(`box "${view.label}": ${labelProblem(view.label)}`);
  if (!Number.isInteger(hours) || hours < view.minHours || hours > view.maxHours) {
    throw new AdminInputError(`stake ${view.minHours} to ${view.maxHours} whole hours`);
  }
  if (view.standing === 'revoked') throw new AdminInputError(`${view.name} is revoked`);
  if (!view.staker) throw new AdminInputError('no staker');
  const amount = BigInt(hours) * view.ratePerHour;
  if (view.staker.gbx < amount) throw new AdminInputError(`the staker holds too little GBX for ${hours}h`);
  const lease = contractAddress('BoxLease');
  const calls: AdminCall[] = [];
  if (view.staker.allowance < amount) {
    calls.push({
      to: contractAddress('GBX'),
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [lease, amount] }),
      what: `approve ${formatUnits(amount, 18)} GBX for BoxLease`,
    });
  }
  calls.push({
    to: lease,
    data: encodeFunctionData({ abi: boxLeaseAbi, functionName: 'stake', args: [view.label, key.qx, key.qy, BigInt(hours)] }),
    gas: CREATES_STORAGE_GAS,
    what: `stake ${hours}h on ${view.name}`,
  });
  return calls;
}

/** Unstakes the Box: every GBX back, and its name suspended. */
export function unstakeCall(view: LeaseView): AdminCall {
  if (!view.lease) throw new AdminInputError(`nothing is staked on ${view.name}`);
  return {
    to: contractAddress('BoxLease'),
    data: encodeFunctionData({ abi: boxLeaseAbi, functionName: 'unstake', args: [view.label] }),
    gas: CREATES_STORAGE_GAS,
    what: `unstake ${view.name}`,
  };
}

/** Closes a lease that ran out: its GBX back to its operator, and the name suspended. */
export function lapseCall(view: LeaseView): AdminCall {
  if (!view.lease) throw new AdminInputError(`nothing is staked on ${view.name}`);
  return {
    to: contractAddress('BoxLease'),
    data: encodeFunctionData({ abi: boxLeaseAbi, functionName: 'lapse', args: [view.label] }),
    gas: CREATES_STORAGE_GAS,
    what: `close ${view.name}'s run-out lease`,
  };
}
