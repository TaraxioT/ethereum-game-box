// The relayer's P-256 check against the contracts' own: the vectors hold digests the contracts computed and
// signatures `P256.sol` accepted.

import {
  EXECUTE_BATCH_VECTOR,
  EXECUTE_VECTOR,
  P256_VECTOR_KEY,
  RESULT_VECTOR,
  WEBAUTHN_VECTOR,
  executeBatchDigest,
  executeDigest,
  resultDigest,
} from '@egb/shared/names';
import { STORE_VECTOR, STORE_VERDICT_VECTOR, STORE_VOID_VECTOR } from '@egb/shared/store';
import { p256 } from '@noble/curves/nist.js';
import { type Hex, concatHex, numberToHex, slice } from 'viem';
import { describe, expect, it } from 'vitest';

import { accountSignatureProblem, isP256Point, p256Problem, recoverSigner } from '../src/verify.ts';
import { highSignature } from './bodies.ts';

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

describe('accountSignatureProblem', () => {
  it("accepts the raw and passkey signatures the contracts' P256Account ran", () => {
    expect(executeBatchDigest(EXECUTE_BATCH_VECTOR.batch, EXECUTE_BATCH_VECTOR.account, EXECUTE_BATCH_VECTOR.chainId)).toBe(
      EXECUTE_BATCH_VECTOR.digest,
    );
    expect(accountSignatureProblem(EXECUTE_VECTOR.digest, EXECUTE_VECTOR.signature, qx, qy)).toBeNull();
    expect(accountSignatureProblem(EXECUTE_BATCH_VECTOR.digest, EXECUTE_BATCH_VECTOR.signature, qx, qy)).toBeNull();
    expect(WEBAUTHN_VECTOR.digest).toBe(EXECUTE_VECTOR.digest);
    expect(accountSignatureProblem(WEBAUTHN_VECTOR.digest, WEBAUTHN_VECTOR.signature, qx, qy)).toBeNull();
  });

  it('refuses the passkey signature for another digest or key, or with a high s', () => {
    expect(accountSignatureProblem(RESULT_VECTOR.digest, WEBAUTHN_VECTOR.signature, qx, qy)).toMatch(/challenge/);
    expect(accountSignatureProblem(WEBAUTHN_VECTOR.digest, WEBAUTHN_VECTOR.signature, qy, qx)).toMatch(/not signed/);
    const high = numberToHex(N - BigInt(WEBAUTHN_VECTOR.s), { size: 32 }).slice(2);
    const signature = `0x${WEBAUTHN_VECTOR.signature.slice(2, 66)}${high}${WEBAUTHN_VECTOR.signature.slice(130)}` as const;
    expect(accountSignatureProblem(WEBAUTHN_VECTOR.digest, signature, qx, qy)).toMatch(/high s/);
  });

  it('refuses a raw signature with a high s, and bytes that are neither form', () => {
    const high = numberToHex(N - BigInt(EXECUTE_VECTOR.s), { size: 32 }).slice(2);
    expect(accountSignatureProblem(EXECUTE_VECTOR.digest, `${EXECUTE_VECTOR.r}${high}`, qx, qy)).toMatch(/high s/);
    expect(accountSignatureProblem(EXECUTE_VECTOR.digest, '0x1234', qx, qy)).toMatch(/not a raw or WebAuthn/);
  });
});

describe('recoverSigner', () => {
  const { digest, signature } = STORE_VERDICT_VECTOR;
  const zero = `0x${'00'.repeat(32)}` as const;

  it('recovers the verifier from the signatures StorePot ran', async () => {
    await expect(recoverSigner(digest, signature)).resolves.toBe(STORE_VECTOR.verifier);
    await expect(recoverSigner(STORE_VOID_VECTOR.digest, STORE_VOID_VECTOR.signature)).resolves.toBe(STORE_VECTOR.verifier);
  });

  const refusals: [string, Hex, string][] = [
    ['no signature', '0x', 'ECDSAInvalidSignatureLength'],
    ['64 bytes', slice(signature, 0, 64), 'ECDSAInvalidSignatureLength'],
    ['66 bytes', concatHex([signature, '0x00']), 'ECDSAInvalidSignatureLength'],
    ['a high s', highSignature(signature), 'ECDSAInvalidSignatureS'],
    ['a v of 0', concatHex([slice(signature, 0, 64), '0x00']), 'ECDSAInvalidSignature'],
    ['a v of 29', concatHex([slice(signature, 0, 64), '0x1d']), 'ECDSAInvalidSignature'],
    ['a zero r and s', concatHex([zero, zero, '0x1b']), 'ECDSAInvalidSignature'],
  ];

  for (const [what, bad, revert] of refusals) {
    it(`refuses ${what}, as the contract does`, async () => {
      await expect(recoverSigner(digest, bad)).rejects.toMatchObject({ status: 401, revert });
    });
  }
});

describe('isP256Point', () => {
  it('knows a key from two random words', () => {
    expect(isP256Point(qx, qy)).toBe(true);
    expect(isP256Point(qx, `0x${'00'.repeat(32)}`)).toBe(false);
  });
});
