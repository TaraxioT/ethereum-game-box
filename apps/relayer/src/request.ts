// A request that passed every check, ready for the sender, and the steps every route shares: the `eth_call` of the
// exact call and its gas limit.

import { type TxKind, contractAddress, ensAddress } from '@egb/shared/names';
import type { Address, Hex } from 'viem';

import type { Client } from './chain.ts';
import { Refusal } from './refusal.ts';
import { isRevert, revertName } from './revert.ts';

/** Our contracts the routes call. */
export interface Addresses {
  names: Address;
  results: Address;
  licences: Address;
  /** ENS's `DefaultReverseRegistrar`, which sets a badge's primary name. */
  reverseRegistrar: Address;
}

export function deployedAddresses(): Addresses {
  return {
    names: contractAddress('GameBoxNames'),
    results: contractAddress('BoxResults'),
    licences: contractAddress('DemoLicences'),
    reverseRegistrar: ensAddress('DefaultReverseRegistrar'),
  };
}

/** What every route's checks read from. */
export interface Context {
  client: Client;
  /** The relayer wallet: the `from` of every `eth_call`. */
  relayer: Address;
  addresses: Addresses;
  /** Unix seconds. */
  now: () => number;
  /** Wei a badge gets from `/names/drip`. */
  dripWei: bigint;
}

/** One transaction, checked. */
export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
  /** Refused for good once sent (a signed digest, or a badge's one drip), until `until` (unix seconds, 0: never). */
  replay?: { key: string; until: number };
}

export interface Prepared extends Call {
  kind: TxKind;
  /** Refused while a request holding any of these is pending (a label, a badge, a Box nonce or round). */
  locks: string[];
  /** A claim's primary-name call, sent once the claim is in a block. */
  primaryName?: Call;
}

/**
 * The limit for a call that creates a resolver or a registry: `eth_estimateGas` comes out too low for nested calls
 * that create storage, and a limit above 2^24 holds the excess as a reservoir for state gas.
 */
export const CREATES_STORAGE_GAS = (1n << 24n) + 4_000_000n;

/** Runs the exact call with `eth_call` from the relayer. A revert is a 422 named by its contract error. */
export async function simulate(ctx: Context, call: { to: Address; data: Hex; value?: bigint }): Promise<void> {
  try {
    await ctx.client.call({ account: ctx.relayer, ...call });
  } catch (error) {
    if (!isRevert(error)) throw error;
    const name = revertName(error);
    throw new Refusal(422, `the call reverts with ${name}`, name);
  }
}

/** `eth_estimateGas` plus 50%. */
export async function estimatedGas(ctx: Context, call: { to: Address; data: Hex; value?: bigint }): Promise<bigint> {
  const gas = await ctx.client.estimateGas({ account: ctx.relayer, ...call });
  return gas + gas / 2n;
}

/** A deadline closer than this (seconds) would pass before the transaction is in a block. */
export const DEADLINE_MARGIN = 24;

/** Throws a 400 if `deadline` has passed, or will before the next blocks. */
export function requireDeadline(ctx: Context, deadline: bigint): void {
  if (deadline < BigInt(ctx.now() + DEADLINE_MARGIN)) {
    throw new Refusal(400, `deadline ${deadline} has passed (or is less than ${DEADLINE_MARGIN}s away)`);
  }
}
