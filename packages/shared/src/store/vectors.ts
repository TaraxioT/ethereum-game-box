// Fixed `Stake`, `Verdict`, `Void` and `Judge` messages with the digests and signatures the contracts produced for them,
// written by the forge test `contracts/test/game/StoreVectors.t.sol` to `vectors.json`. The Box's signatures use the
// names vector Box key (`P256_VECTOR_KEY`); the verifier's key is anvil's second well-known key. Both are throwaway test
// keys, never real ones.

import { type Address, type Hex, hexToString } from 'viem';

import vectors from './vectors.json' with { type: 'json' };

import type { StoreStake, StoreVerdict, StoreVoid } from './api.ts';
import type { Judge } from './messages.ts';

/** What every store vector shares: `StorePot` at a fixed address, and its verifier. */
export const STORE_VECTOR = {
  storePot: vectors.storePot as Address,
  chainId: Number(vectors.chainId),
  verifierKey: vectors.verifierKey as Hex,
  verifier: vectors.verifier as Address,
} as const;

/** `Stake` for four players, signed over the raw digest with a low `s`, and run through `StorePot.open`. */
export const STORE_STAKE_VECTOR = {
  message: {
    box: vectors.stake.box,
    bundle: vectors.stake.bundle as Hex,
    round: BigInt(vectors.stake.round),
    players: vectors.stake.players as Address[],
    amount: BigInt(vectors.stake.amount),
    deadline: BigInt(vectors.stake.deadline),
  } satisfies StoreStake,
  /** `StorePot.stakeDigest`. */
  digest: vectors.stake.digest as Hex,
  r: vectors.stake.r as Hex,
  s: vectors.stake.s as Hex,
} as const;

/** `Verdict` paying that pot an uneven split with a zero share, signed by the verifier and run through `settle`. */
export const STORE_VERDICT_VECTOR = {
  message: {
    box: vectors.verdict.box,
    round: BigInt(vectors.verdict.round),
    payouts: vectors.verdict.payouts.map(BigInt),
    record: vectors.verdict.record as Hex,
    deadline: BigInt(vectors.verdict.deadline),
  } satisfies StoreVerdict,
  /** The audit record's exact JSON text, which `record` hashes. */
  recordText: hexToString(vectors.verdict.recordText as Hex),
  /** `StorePot.verdictDigest`. */
  digest: vectors.verdict.digest as Hex,
  /** `r ‖ s ‖ v`, 65 bytes. */
  signature: vectors.verdict.signature as Hex,
} as const;

/** `Void` of a second pot, signed by the verifier and run through `voidPot`. */
export const STORE_VOID_VECTOR = {
  message: {
    box: vectors.void.box,
    round: BigInt(vectors.void.round),
    record: vectors.void.record as Hex,
    deadline: BigInt(vectors.void.deadline),
  } satisfies StoreVoid,
  /** `StorePot.voidDigest`. */
  digest: vectors.void.digest as Hex,
  /** `r ‖ s ‖ v`, 65 bytes. */
  signature: vectors.void.signature as Hex,
} as const;

/** `Judge`, signed over the raw digest with a low `s`. No contract computes it: forge builds it from the EIP-712 spec. */
export const JUDGE_VECTOR = {
  message: {
    box: vectors.judge.box,
    round: BigInt(vectors.judge.round),
    log: vectors.judge.log as Hex,
    deadline: BigInt(vectors.judge.deadline),
  } satisfies Judge,
  /** The log's exact JSON text, which `log` hashes. */
  logText: hexToString(vectors.judge.logText as Hex),
  digest: vectors.judge.digest as Hex,
  r: vectors.judge.r as Hex,
  s: vectors.judge.s as Hex,
} as const;
