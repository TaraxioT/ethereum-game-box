// A passkey's public key recovered from a sign-in, a signature checked, and a key read from text.

import { describe, expect, it } from 'vitest';
import { hexToBytes } from 'viem';

import { assertionHash, p256PublicKeyHex, parseP256PublicKey, recoverP256Keys, sameP256Key, verifyP256 } from './p256.ts';
import { P256_VECTOR_KEY, WEBAUTHN_VECTOR } from './vectors.ts';

const key = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };
const hash = assertionHash(hexToBytes(WEBAUTHN_VECTOR.authenticatorData), hexToBytes(WEBAUTHN_VECTOR.clientDataJSON));
const r = BigInt(WEBAUTHN_VECTOR.r);
const s = BigInt(WEBAUTHN_VECTOR.s);

describe('recoverP256Keys', () => {
  it("finds the vector passkey's key among the keys its signature recovers to", () => {
    const keys = recoverP256Keys(r, s, hash);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => sameP256Key(k, key))).toBe(true);
    for (const k of keys) expect(verifyP256(k, r, s, hash)).toBe(true);
  });
});

describe('verifyP256', () => {
  it("accepts the key's signature and refuses another hash", () => {
    expect(verifyP256(key, r, s, hash)).toBe(true);
    expect(verifyP256(key, r, s, new Uint8Array(32))).toBe(false);
  });
});

describe('parseP256PublicKey', () => {
  it('reads 0x04 + x + y, and x + y', () => {
    const text = p256PublicKeyHex(key);
    expect(parseP256PublicKey(text)).toEqual(key);
    expect(parseP256PublicKey(text.slice(4))).toEqual(key);
    expect(parseP256PublicKey(`  ${text.toUpperCase().replace('0X', '0x')}  `)).toEqual(key);
  });

  it("refuses what isn't a point on P-256", () => {
    expect(parseP256PublicKey(`0x04${'00'.repeat(64)}`)).toBeNull();
    expect(parseP256PublicKey(`0x04${P256_VECTOR_KEY.qx.slice(2)}${'01'.repeat(32)}`)).toBeNull();
    expect(parseP256PublicKey('0x1234')).toBeNull();
    expect(parseP256PublicKey('not a key')).toBeNull();
  });
});
