// Fixed inputs with the digests and signatures the contracts produce for them, written by the forge test
// `contracts/test/names/Vectors.t.sol` to `vectors.json`. Every key here is a throwaway test key, never a real one:
// the claim's badge key is anvil's first well-known key.

import type { Address, Hex } from 'viem';

import vectors from './vectors.json' with { type: 'json' };

import type { ClaimName, Execute, Result } from './messages.ts';

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

/** `Execute` for a `BoxAccount` on `P256_VECTOR_KEY`, signed over the raw digest with a low `s`. */
export const EXECUTE_VECTOR = {
  account: vectors.execute.account as Address,
  chainId: Number(vectors.chainId),
  call: {
    target: vectors.execute.target as Address,
    value: BigInt(vectors.execute.value),
    data: vectors.execute.data as Hex,
    nonce: BigInt(vectors.execute.nonce),
    deadline: BigInt(vectors.execute.deadline),
  } satisfies Execute,
  /** `BoxAccount.executeDigest`. */
  digest: vectors.execute.digest as Hex,
  r: vectors.execute.r as Hex,
  s: vectors.execute.s as Hex,
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

/** The role bits as `IENSv2.sol` defines them, for `roles.test.ts`. */
export const ROLE_VECTORS = {
  registry: vectors.registryRoles as Record<string, Hex>,
  resolver: vectors.resolverRoles as Record<string, Hex>,
} as const;
