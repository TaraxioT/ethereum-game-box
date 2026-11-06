// Fixed inputs with the digests and signatures the contracts produce for them, written by the forge test
// `contracts/test/names/Vectors.t.sol` to `vectors.json`. Every key here is a throwaway test key, never a real one:
// the claim's badge key is anvil's first well-known key.

import type { Address, Hex } from 'viem';

import vectors from './vectors.json' with { type: 'json' };

import type { ClaimName, Execute, ExecuteBatch, Result, Seat, Stake } from './messages.ts';
import type { PrimaryName } from './primaryName.ts';

/** `ClaimName` for `alice`, signed by the badge as viem `signTypedData` (and `eth_signTypedData_v4`) produces it. */
export const CLAIM_NAME_VECTOR = {
  privateKey: vectors.claimName.privateKey as Hex,
  gameBoxNames: vectors.claimName.gameBoxNames as Address,
  chainId: Number(vectors.chainId),
  message: {
    label: vectors.claimName.label,
    badge: vectors.claimName.badge as Address,
    deadline: BigInt(vectors.claimName.deadline),
  } satisfies ClaimName,
  /** `GameBoxNames.claimDigest`. */
  digest: vectors.claimName.digest as Hex,
  /** `r ‖ s ‖ v`, 65 bytes. */
  signature: vectors.claimName.signature as Hex,
} as const;

/** The P-256 key of the vector Box: a `0x` 32-byte scalar, and its public point. */
export const P256_VECTOR_KEY = {
  privateKey: vectors.p256.privateKey as Hex,
  qx: vectors.p256.qx as Hex,
  qy: vectors.p256.qy as Hex,
} as const;

/** `Execute` for the `P256Account` of `P256_VECTOR_KEY`, signed over the raw digest with a low `s`. */
export const EXECUTE_VECTOR = {
  /** The `P256AccountFactory` that made `account` (on the test fork). */
  factory: vectors.execute.factory as Address,
  account: vectors.execute.account as Address,
  chainId: Number(vectors.chainId),
  call: {
    target: vectors.execute.target as Address,
    value: BigInt(vectors.execute.value),
    data: vectors.execute.data as Hex,
    nonce: BigInt(vectors.execute.nonce),
    deadline: BigInt(vectors.execute.deadline),
  } satisfies Execute,
  /** `P256Account.executeDigest`. */
  digest: vectors.execute.digest as Hex,
  r: vectors.execute.r as Hex,
  s: vectors.execute.s as Hex,
  /** The raw form, `r ‖ s`. */
  signature: vectors.execute.signature as Hex,
} as const;

/** `executeBatch` of two calls for the same account, signed raw. */
export const EXECUTE_BATCH_VECTOR = {
  account: vectors.batch.account as Address,
  chainId: Number(vectors.chainId),
  batch: {
    calls: [
      { target: vectors.batch.target0 as Address, value: BigInt(vectors.batch.value0), data: vectors.batch.data0 as Hex },
      { target: vectors.batch.target1 as Address, value: BigInt(vectors.batch.value1), data: vectors.batch.data1 as Hex },
    ],
    nonce: BigInt(vectors.batch.nonce),
    deadline: BigInt(vectors.batch.deadline),
  } satisfies ExecuteBatch,
  /** `keccak256(abi.encode(calls))`. */
  dataHash: vectors.batch.dataHash as Hex,
  /** `P256Account.batchDigest`. */
  digest: vectors.batch.digest as Hex,
  signature: vectors.batch.signature as Hex,
} as const;

/** A passkey's (WebAuthn) signature of `EXECUTE_VECTOR`'s digest by `P256_VECTOR_KEY`, which the account ran. */
export const WEBAUTHN_VECTOR = {
  /** The challenge: `EXECUTE_VECTOR.digest`. */
  digest: vectors.webAuthn.digest as Hex,
  authenticatorData: vectors.webAuthn.authenticatorData as Hex,
  /** The UTF-8 bytes of `clientDataJSON`. */
  clientDataJSON: vectors.webAuthn.clientDataJSON as Hex,
  challengeIndex: Number(vectors.webAuthn.challengeIndex),
  typeIndex: Number(vectors.webAuthn.typeIndex),
  r: vectors.webAuthn.r as Hex,
  /** Low. */
  s: vectors.webAuthn.s as Hex,
  /** The encoded assertion `P256Account` takes. */
  signature: vectors.webAuthn.signature as Hex,
} as const;

/** `Result` for `BoxResults`, signed by `P256_VECTOR_KEY` over the raw digest with a low `s`. */
export const RESULT_VECTOR = {
  boxResults: vectors.result.boxResults as Address,
  chainId: Number(vectors.chainId),
  result: {
    box: vectors.result.box,
    game: vectors.result.game,
    round: BigInt(vectors.result.round),
    winner: vectors.result.winner as Address,
    loser: vectors.result.loser as Address,
    draw: vectors.result.draw,
    deadline: BigInt(vectors.result.deadline),
  } satisfies Result,
  /** `BoxResults.resultDigest`. */
  digest: vectors.result.digest as Hex,
  r: vectors.result.r as Hex,
  s: vectors.result.s as Hex,
} as const;

/** `Stake` for `DuelPot`, signed by `P256_VECTOR_KEY` over the raw digest with a low `s`. */
export const STAKE_VECTOR = {
  duelPot: vectors.stake.duelPot as Address,
  chainId: Number(vectors.chainId),
  stake: {
    box: vectors.stake.box,
    game: vectors.stake.game,
    round: BigInt(vectors.stake.round),
    a: vectors.stake.a as Address,
    b: vectors.stake.b as Address,
    amount: BigInt(vectors.stake.amount),
    deadline: BigInt(vectors.stake.deadline),
  } satisfies Stake,
  /** `DuelPot.stakeDigest`. */
  digest: vectors.stake.digest as Hex,
  r: vectors.stake.r as Hex,
  s: vectors.stake.s as Hex,
} as const;

/** `Seat` for `BoxSeats`, signed by `P256_VECTOR_KEY` over the raw digest with a low `s`. */
export const SEAT_VECTOR = {
  boxSeats: vectors.seat.boxSeats as Address,
  chainId: Number(vectors.chainId),
  seat: {
    label: vectors.seat.label,
    badge: vectors.seat.badge as Address,
    box: vectors.seat.box,
    deadline: BigInt(vectors.seat.deadline),
  } satisfies Seat,
  /** `BoxSeats.seatDigest`. */
  digest: vectors.seat.digest as Hex,
  r: vectors.seat.r as Hex,
  s: vectors.seat.s as Hex,
} as const;

/** A badge's primary-name message for ENS's `DefaultReverseRegistrar`, signed with `personal_sign` as viem
 *  `signMessage({ message: { raw } })` signs it. */
export const PRIMARY_NAME_VECTOR = {
  privateKey: vectors.claimName.privateKey as Hex,
  registrar: vectors.primaryName.registrar as Address,
  message: {
    badge: vectors.primaryName.badge as Address,
    name: vectors.primaryName.name,
    expiry: BigInt(vectors.primaryName.expiry),
  } satisfies PrimaryName,
  /** The 32 bytes signed. */
  raw: vectors.primaryName.message as Hex,
  /** Their ERC-191 digest. */
  digest: vectors.primaryName.digest as Hex,
  signature: vectors.primaryName.signature as Hex,
} as const;

/** The role bits as `IENSv2.sol` defines them, for `vectors.test.ts`. */
export const ROLE_VECTORS = {
  registry: vectors.registryRoles as Record<string, Hex>,
  resolver: vectors.resolverRoles as Record<string, Hex>,
} as const;
