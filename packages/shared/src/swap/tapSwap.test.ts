// Checks tapSwap.ts byte for byte against what `GameBoxHook` computed (vectors.json, written by
// `contracts/test/hook/SwapVectors.t.sol`), and that the vector signature verifies the way the hook verifies it.

import { p256 } from '@noble/curves/nist.js';
import { hexToBytes } from 'viem';
import { describe, expect, it } from 'vitest';

import { P256_VECTOR_KEY } from '../names/vectors.ts';
import { tapSwapDigest, tapSwapHookData } from './tapSwap.ts';
import { TAP_SWAP_VECTOR } from './vectors.ts';

const HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;

describe('TapSwap', () => {
  const { swap, hook, chainId, digest, r, s, hookData } = TAP_SWAP_VECTOR;

  it('matches GameBoxHook.tapSwapDigest', () => {
    expect(tapSwapDigest(swap, hook, chainId)).toBe(digest);
  });

  it('is a P-256 signature over the raw digest, low s', () => {
    const publicKey = hexToBytes(`0x04${P256_VECTOR_KEY.qx.slice(2)}${P256_VECTOR_KEY.qy.slice(2)}`);
    expect(BigInt(s) <= HALF_N).toBe(true);
    const signature = hexToBytes(`0x${r.slice(2)}${s.slice(2)}`);
    expect(p256.verify(signature, hexToBytes(digest), publicKey, { prehash: false, lowS: true })).toBe(true);
  });

  it('encodes the hook data the hook decodes', () => {
    expect(tapSwapHookData(swap, r, s)).toBe(hookData);
  });
});
