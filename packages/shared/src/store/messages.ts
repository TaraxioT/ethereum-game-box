// The game store's EIP-712 messages, fixed in `StorePot` and the verifier:
// - `Stake`: a store game's stakes, signed by the Box's P-256 key for `StorePot.open`.
// - `Verdict`: who gets paid how much, signed by a key with `VERIFIER_ROLE` for `StorePot.settle`.
// - `Void`: every stake goes back, signed by a key with `VERIFIER_ROLE` for `StorePot.voidPot`.
// - `Judge`: a match's log, signed by the Box's P-256 key for the verifier. No contract checks it: the Worker does, off
//   chain, against the Box's key in `GameBoxNames`.
// Each `*TypedData` function returns what a wallet signs (viem `signTypedData`), and each `*Digest` function returns the
// 32 bytes the signature is checked against. A Box signs its digest raw, with no prehash, like the names messages.

import { type Address, type Hex, hashTypedData, keccak256, stringToBytes } from 'viem';

import { chainId as deploymentsChainId } from '../names/deployments.ts';
import type { StoreStake, StoreVerdict, StoreVoid } from './api.ts';

export const STORE_POT_DOMAIN = { name: 'Game Box Store Pots', version: '1' } as const;
export const VERIFIER_DOMAIN = { name: 'Game Box Verifier', version: '1' } as const;

export const storeStakeTypes = {
  Stake: [
    { name: 'box', type: 'string' },
    { name: 'bundle', type: 'bytes32' },
    { name: 'round', type: 'uint256' },
    { name: 'players', type: 'address[]' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const storeVerdictTypes = {
  Verdict: [
    { name: 'box', type: 'string' },
    { name: 'round', type: 'uint256' },
    { name: 'payouts', type: 'uint256[]' },
    { name: 'record', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const storeVoidTypes = {
  Void: [
    { name: 'box', type: 'string' },
    { name: 'round', type: 'uint256' },
    { name: 'record', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const judgeTypes = {
  Judge: [
    { name: 'box', type: 'string' },
    { name: 'round', type: 'uint256' },
    { name: 'log', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** A finished match's log, as the Box vouches for it to the verifier. */
export interface Judge {
  /** The Box's label, e.g. `mumbai-01`. */
  readonly box: string;
  readonly round: bigint;
  /** `jsonTextHash` of the log's exact JSON text. */
  readonly log: Hex;
  /** Unix seconds. */
  readonly deadline: bigint;
}

/** The keccak256 of exact JSON text, as UTF-8: a `Judge`'s `log`, and an audit record's on-chain `record`. Hash the text
 *  that was sent, never a re-serialized copy of it. */
export function jsonTextHash(text: string): Hex {
  return keccak256(stringToBytes(text));
}

/** `Stake`, for `StorePot` at `storePot`. */
export function storeStakeTypedData(stake: StoreStake, storePot: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...STORE_POT_DOMAIN, chainId, verifyingContract: storePot },
    types: storeStakeTypes,
    primaryType: 'Stake',
    message: stake,
  } as const;
}

/** `Verdict`, for `StorePot` at `storePot`. */
export function storeVerdictTypedData(verdict: StoreVerdict, storePot: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...STORE_POT_DOMAIN, chainId, verifyingContract: storePot },
    types: storeVerdictTypes,
    primaryType: 'Verdict',
    message: verdict,
  } as const;
}

/** `Void`, for `StorePot` at `storePot`. */
export function storeVoidTypedData(voiding: StoreVoid, storePot: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...STORE_POT_DOMAIN, chainId, verifyingContract: storePot },
    types: storeVoidTypes,
    primaryType: 'Void',
    message: voiding,
  } as const;
}

/** `Judge`, for the verifier of `StorePot` at `storePot`: its domain's `verifyingContract` is the pot. */
export function judgeTypedData(judge: Judge, storePot: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...VERIFIER_DOMAIN, chainId, verifyingContract: storePot },
    types: judgeTypes,
    primaryType: 'Judge',
    message: judge,
  } as const;
}

/** The digest `StorePot.stakeDigest` returns. The Box signs it with P-256. */
export function storeStakeDigest(stake: StoreStake, storePot: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(storeStakeTypedData(stake, storePot, chainId));
}

/** The digest `StorePot.verdictDigest` returns. A verifier key signs it with ECDSA. */
export function storeVerdictDigest(verdict: StoreVerdict, storePot: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(storeVerdictTypedData(verdict, storePot, chainId));
}

/** The digest `StorePot.voidDigest` returns. A verifier key signs it with ECDSA. */
export function storeVoidDigest(voiding: StoreVoid, storePot: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(storeVoidTypedData(voiding, storePot, chainId));
}

/** The digest the verifier checks a `JudgeRequest`'s `(r, s)` against. The Box signs it with P-256. */
export function judgeDigest(judge: Judge, storePot: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(judgeTypedData(judge, storePot, chainId));
}
