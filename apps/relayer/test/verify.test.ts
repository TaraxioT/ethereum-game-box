// The relayer's P-256 check against the contracts' own: the vectors hold digests the contracts computed and
// signatures `P256.sol` accepted.

import { EXECUTE_VECTOR, P256_VECTOR_KEY, RESULT_VECTOR, executeDigest, resultDigest } from '@egb/shared/names';
import { p256 } from '@noble/curves/nist.js';
import { numberToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { p256Problem } from '../src/verify.ts';

const { qx, qy } = P256_VECTOR_KEY;
const N = p256.Point.CURVE().n;

describe('p256Problem', () => {
  it('accepts the signatures the contracts accept', () => {
    expect(executeDigest(EXECUTE_VECTOR.call, EXECUTE_VECTOR.account, EXECUTE_VECTOR.chainId)).toBe(EXECUTE_VECTOR.digest);
    expect(resultDigest(RESULT_VECTOR.result, RESULT_VECTOR.boxResults, RESULT_VECTOR.chainId)).toBe(RESULT_VECTOR.digest);
    expect(p256Problem(EXECUTE_VECTOR.digest, EXECUTE_VECTOR.r, EXECUTE_VECTOR.s, qx, qy)).toBeNull();
    expect(p256Problem(RESULT_VECTOR.digest, RESULT_VECTOR.r, RESULT_VECTOR.s, qx, qy)).toBeNull();
  });

  it('refuses the same signature with a high s, as the contracts do', () => {
    const high = numberToHex(N - BigInt(EXECUTE_VECTOR.s), { size: 32 });
    expect(p256Problem(EXECUTE_VECTOR.digest, EXECUTE_VECTOR.r, high, qx, qy)).toMatch(/high s/);
  });

  it('refuses another digest, another key and a zero signature', () => {
    expect(p256Problem(RESULT_VECTOR.digest, EXECUTE_VECTOR.r, EXECUTE_VECTOR.s, qx, qy)).toMatch(/not signed/);
    expect(p256Problem(EXECUTE_VECTOR.digest, EXECUTE_VECTOR.r, EXECUTE_VECTOR.s, qy, qx)).toMatch(/not signed/);
    const zero = `0x${'00'.repeat(32)}` as const;
    expect(p256Problem(EXECUTE_VECTOR.digest, zero, zero, qx, qy)).toMatch(/not signed/);
  });
});
