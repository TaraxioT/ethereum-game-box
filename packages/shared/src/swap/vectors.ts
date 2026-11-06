// A fixed `TapSwap` with the digest, signature and hook data `GameBoxHook` produced for it, written by the forge test
// `contracts/test/hook/SwapVectors.t.sol` to `vectors.json`. It is signed by the names vector Box key
// (`P256_VECTOR_KEY`), a throwaway test key.

import type { Address, Hex } from 'viem';

import vectors from './vectors.json' with { type: 'json' };

import type { TapSwap } from './tapSwap.ts';

/** `TapSwap` for a hook at a fixed address, signed over the raw digest with a low `s`. */
export const TAP_SWAP_VECTOR = {
  hook: vectors.hook as Address,
  chainId: Number(vectors.chainId),
  swap: {
    box: vectors.box,
    badge: vectors.badge as Address,
    sender: vectors.sender as Address,
    zeroForOne: vectors.zeroForOne,
    amountSpecified: BigInt(vectors.amountSpecified),
    nonce: BigInt(vectors.nonce),
    deadline: BigInt(vectors.deadline),
  } satisfies TapSwap,
  /** `GameBoxHook.tapSwapDigest`. */
  digest: vectors.digest as Hex,
  r: vectors.r as Hex,
  s: vectors.s as Hex,
  /** `abi.encode(TapSwapData)`. */
  hookData: vectors.hookData as Hex,
} as const;
