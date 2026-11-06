// The EIP-712 messages of the Game Box, fixed in the contracts:
// - `ClaimName`: a badge's consent to a player name, checked by `GameBoxNames` (ECDSA or ERC-1271).
// - `Execute`: a call (or a batch of calls) a `P256Account`'s key signs: the Box's HYP2003, a passkey or a Worker key.
// - `Result`: a match result the Box's P-256 key signs for `BoxResults`.
// - `Stake`: a match's USDC stakes the Box's P-256 key signs for `DuelPot`. Its `(box, round)` is the `Result`'s.
// - `Seat`: a player name for a badge that tapped the Box, signed by the Box's P-256 key for `BoxSeats` (a HaLo badge
//   can't sign a `ClaimName`).
// Each `*TypedData` function returns what a wallet signs (`eth_signTypedData_v4`, viem `signTypedData`), and each
// `*Digest` function returns the 32 bytes the contract checks the signature against. A P-256 key signs that digest
// raw, or as a passkey's challenge (`webauthn.ts`).

import { type Address, type Hex, encodeAbiParameters, hashTypedData, keccak256 } from 'viem';

import { chainId as deploymentsChainId } from './deployments.ts';

export const CLAIM_NAME_DOMAIN = { name: 'Game Box Names', version: '1' } as const;
export const EXECUTE_DOMAIN = { name: 'Game Box', version: '1' } as const;
export const RESULT_DOMAIN = { name: 'Game Box Results', version: '1' } as const;
export const STAKE_DOMAIN = { name: 'Game Box Stakes', version: '1' } as const;
export const SEAT_DOMAIN = { name: 'Game Box Seats', version: '1' } as const;

export const claimNameTypes = {
  ClaimName: [
    { name: 'label', type: 'string' },
    { name: 'badge', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const executeTypes = {
  Execute: [
    { name: 'target', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'dataHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const resultTypes = {
  Result: [
    { name: 'box', type: 'string' },
    { name: 'game', type: 'string' },
    { name: 'round', type: 'uint256' },
    { name: 'winner', type: 'address' },
    { name: 'loser', type: 'address' },
    { name: 'draw', type: 'bool' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const stakeTypes = {
  Stake: [
    { name: 'box', type: 'string' },
    { name: 'game', type: 'string' },
    { name: 'round', type: 'uint256' },
    { name: 'a', type: 'address' },
    { name: 'b', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const seatTypes = {
  Seat: [
    { name: 'label', type: 'string' },
    { name: 'badge', type: 'address' },
    { name: 'box', type: 'string' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** A badge's consent to `<label>.gamebox.eth`. */
export interface ClaimName {
  label: string;
  badge: Address;
  /** Unix seconds. */
  deadline: bigint;
}

/** One call for a `P256Account` to run. */
export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

/** A call for a `P256Account` to run (`execute`). The key signs `keccak256(data)` as `dataHash`. Any unused nonce works
 *  once. `target` may be the account itself, for `rotateKey`. */
export interface Execute extends Call {
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
}

/** Calls for a `P256Account` to run in order, all or none, under one signature (`executeBatch`). */
export interface ExecuteBatch {
  calls: readonly Call[];
  nonce: bigint;
  /** Unix seconds. */
  deadline: bigint;
}

/** A finished match, as the Box reports it. */
export interface Result {
  /** The Box's label, e.g. `mumbai-01`. */
  box: string;
  /** The game's label, e.g. `quickdraw`. */
  game: string;
  round: bigint;
  winner: Address;
  loser: Address;
  draw: boolean;
  /** Unix seconds. */
  deadline: bigint;
}

/** A match's stakes, as the Box vouches for them. `DuelPot.open` pulls `amount` from each player. */
export interface Stake {
  /** The Box's label, e.g. `mumbai-01`. */
  box: string;
  /** The game's label, e.g. `stockduel`. */
  game: string;
  /** The Box's round number: the same as the match's `Result`. */
  round: bigint;
  /** One player's badge. */
  a: Address;
  /** The other player's badge. */
  b: Address;
  /** Each player's stake, in USDC base units (6 decimals: `usdc(10)` is 10 USDC). */
  amount: bigint;
  /** Unix seconds. */
  deadline: bigint;
}

/** A player name for a badge that tapped the Box, as the Box vouches for it. `BoxSeats.claim` claims it. */
export interface Seat {
  /** The player's label (`labelProblem`). */
  label: string;
  /** The badge (its key-2 address). */
  badge: Address;
  /** The Box's label. */
  box: string;
  /** Unix seconds. */
  deadline: bigint;
}

/** `ClaimName`, for `GameBoxNames` at `gameBoxNames`. */
export function claimNameTypedData(message: ClaimName, gameBoxNames: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...CLAIM_NAME_DOMAIN, chainId, verifyingContract: gameBoxNames },
    types: claimNameTypes,
    primaryType: 'ClaimName',
    message,
  } as const;
}

/** `Execute`, for the `P256Account` at `account`. */
export function executeTypedData(call: Execute, account: Address, chainId = deploymentsChainId) {
  const { target, value, data, nonce, deadline } = call;
  return {
    domain: { ...EXECUTE_DOMAIN, chainId, verifyingContract: account },
    types: executeTypes,
    primaryType: 'Execute',
    message: { target, value, dataHash: keccak256(data), nonce, deadline },
  } as const;
}

/** `abi.encode(calls)` as Solidity encodes a `P256Account.Call[]`: what a batch's `dataHash` hashes. */
export function encodeCalls(calls: readonly Call[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [calls],
  );
}

/** `Execute` for `executeBatch` on the `P256Account` at `account`: `target` is the account, `value` 0 and `dataHash`
 *  `keccak256(encodeCalls(calls))`. */
export function executeBatchTypedData(batch: ExecuteBatch, account: Address, chainId = deploymentsChainId) {
  const { calls, nonce, deadline } = batch;
  return executeTypedData({ target: account, value: 0n, data: encodeCalls(calls), nonce, deadline }, account, chainId);
}

/** `Result`, for `BoxResults` at `boxResults`. */
export function resultTypedData(result: Result, boxResults: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...RESULT_DOMAIN, chainId, verifyingContract: boxResults },
    types: resultTypes,
    primaryType: 'Result',
    message: result,
  } as const;
}

/** `Stake`, for `DuelPot` at `duelPot`. */
export function stakeTypedData(stake: Stake, duelPot: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...STAKE_DOMAIN, chainId, verifyingContract: duelPot },
    types: stakeTypes,
    primaryType: 'Stake',
    message: stake,
  } as const;
}

/** `Seat`, for `BoxSeats` at `boxSeats`. */
export function seatTypedData(seat: Seat, boxSeats: Address, chainId = deploymentsChainId) {
  return {
    domain: { ...SEAT_DOMAIN, chainId, verifyingContract: boxSeats },
    types: seatTypes,
    primaryType: 'Seat',
    message: seat,
  } as const;
}

/** The digest `GameBoxNames.claimDigest` returns. */
export function claimNameDigest(message: ClaimName, gameBoxNames: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(claimNameTypedData(message, gameBoxNames, chainId));
}

/** The digest `P256Account.executeDigest` returns. The account's key signs it with P-256. */
export function executeDigest(call: Execute, account: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(executeTypedData(call, account, chainId));
}

/** The digest `P256Account.batchDigest` returns. The account's key signs it with P-256. */
export function executeBatchDigest(batch: ExecuteBatch, account: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(executeBatchTypedData(batch, account, chainId));
}

/** The digest `BoxResults.resultDigest` returns. The Box signs it with P-256. */
export function resultDigest(result: Result, boxResults: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(resultTypedData(result, boxResults, chainId));
}

/** The digest `DuelPot.stakeDigest` returns. The Box signs it with P-256. */
export function stakeDigest(stake: Stake, duelPot: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(stakeTypedData(stake, duelPot, chainId));
}

/** The digest `BoxSeats.seatDigest` returns. The Box signs it with P-256. */
export function seatDigest(seat: Seat, boxSeats: Address, chainId = deploymentsChainId): Hex {
  return hashTypedData(seatTypedData(seat, boxSeats, chainId));
}
