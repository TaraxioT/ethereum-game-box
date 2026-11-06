// A request that passed every check, ready for the sender, and the steps every route shares: the `eth_call` of the
// exact call and its gas limit.

import { type TxKind, contractAddress, ensAddress, namesProxies, ourContract } from '@egb/shared/names';
import type { Address, Hex } from 'viem';

import type { Client } from './chain.ts';
import { Refusal } from './refusal.ts';
import { isRevert, revertName } from './revert.ts';
import { deployedTargets } from './targets.ts';

/** Our contracts the routes call. */
export interface Addresses {
  names: Address;
  results: Address;
  licences: Address;
  /** The demo's test USDC (`FakeUSDC`): top-ups are minted from it, and stakes are paid in it. */
  usdc: Address;
  /** `DuelPot`: a match's USDC pot. */
  pot: Address;
  /** `Championships`. */
  cups: Address;
  /** `BoxSeats`: player names a Box vouched for. */
  seats: Address;
  /** `P256AccountFactory`, and the block it was deployed in. */
  factory: Address;
  factoryBlock: bigint;
  /** `gamebox.eth`'s own registry: where a `<label>.gamebox.eth` name's resolver is set. */
  registry: Address;
  /** ENS's `DefaultReverseRegistrar`, which sets a badge's primary name. */
  reverseRegistrar: Address;
  /** Every address in `deployments/sepolia.json` an account may call, lower-cased. */
  targets: ReadonlySet<string>;
}

export function deployedAddresses(): Addresses {
  const factory = ourContract('P256AccountFactory');
  if (!factory) throw new Error('P256AccountFactory is not in deployments/sepolia.json');
  return {
    names: contractAddress('GameBoxNames'),
    results: contractAddress('BoxResults'),
    licences: contractAddress('DemoLicences'),
    usdc: contractAddress('FakeUSDC'),
    pot: contractAddress('DuelPot'),
    cups: contractAddress('Championships'),
    seats: contractAddress('BoxSeats'),
    factory: factory.address,
    factoryBlock: BigInt(factory.deployBlock),
    registry: namesProxies().registry,
    reverseRegistrar: ensAddress('DefaultReverseRegistrar'),
    targets: deployedTargets(),
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
  /** Whom the per-address rate limits count: an `execute`'s `P256Account`, a top-up's player. */
  account?: Address;
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

/** An estimate above this means the call creates a resolver or a registry (1.3 to 4M gas), which it underestimates. */
export const CREATES_STORAGE_ESTIMATE = 1_000_000n;

/** The limit for a call whose effect isn't fixed in advance (an account's `execute`, a result that may settle a pot
 *  and score a championship): the estimate plus 50%, or at least `CREATES_STORAGE_GAS` if the estimate says it creates
 *  storage. */
export async function callGas(ctx: Context, call: { to: Address; data: Hex }): Promise<bigint> {
  const gas = await estimatedGas(ctx, call);
  return gas >= CREATES_STORAGE_ESTIMATE + CREATES_STORAGE_ESTIMATE / 2n && gas < CREATES_STORAGE_GAS
    ? CREATES_STORAGE_GAS
    : gas;
}

/** A deadline closer than this (seconds) would pass before the transaction is in a block. */
export const DEADLINE_MARGIN = 24;

/** Throws a 400 if `deadline` has passed, or will before the next blocks. */
export function requireDeadline(ctx: Context, deadline: bigint): void {
  if (deadline < BigInt(ctx.now() + DEADLINE_MARGIN)) {
    throw new Refusal(400, `deadline ${deadline} has passed (or is less than ${DEADLINE_MARGIN}s away)`);
  }
}
