// The parts of webauthn.ts the vectors don't reach: reading a passkey's public key, and refusing malformed input.

import { generateKeyPairSync } from 'node:crypto';

import { bytesToHex, hexToBytes, numberToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { P256_VECTOR_KEY, WEBAUTHN_VECTOR } from './vectors.ts';
import {
  assertionSignature,
  base64url,
  checkAssertion,
  encodeWebAuthnSignature,
  fromBase64url,
  lowS,
  P256_HALF_N,
  P256_N,
  p256PublicKeyFromSpki,
} from './webauthn.ts';

describe('p256PublicKeyFromSpki', () => {
  it('reads x and y from a P-256 SubjectPublicKeyInfo', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
    const jwk = publicKey.export({ format: 'jwk' });
    const hex = (b64url: string | undefined) => bytesToHex(Buffer.from(b64url ?? '', 'base64url'));
    expect(p256PublicKeyFromSpki(spki)).toEqual({ qx: hex(jwk.x), qy: hex(jwk.y) });
  });

  it('refuses another curve', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const spki = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
    expect(() => p256PublicKeyFromSpki(spki)).toThrow('not a P-256 public key');
  });
});

describe('lowS', () => {
  it('keeps a low s and flips a high one', () => {
    expect(lowS(1n)).toBe(1n);
    expect(lowS(P256_HALF_N)).toBe(P256_HALF_N);
    expect(lowS(P256_HALF_N + 1n)).toBe(P256_N - P256_HALF_N - 1n);
  });
});

describe('encodeWebAuthnSignature', () => {
  it('refuses clientDataJSON without the type or the challenge', () => {
    const base = { authenticatorData: '0x00' as const, r: 1n, s: 1n };
    expect(() => encodeWebAuthnSignature({ ...base, clientDataJSON: '{"challenge":"x"}' })).toThrow('"type"');
    expect(() => encodeWebAuthnSignature({ ...base, clientDataJSON: '{"type":"webauthn.get"}' })).toThrow('"challenge"');
  });
});

/** DER `SEQUENCE { INTEGER r, INTEGER s }`, as an authenticator returns a signature. */
function der(r: bigint, s: bigint): Uint8Array {
  const int = (n: bigint) => {
    let bytes = hexToBytes(numberToHex(n));
    if (bytes[0]! >= 0x80) bytes = Uint8Array.of(0, ...bytes);
    return [0x02, bytes.length, ...bytes];
  };
  const body = [...int(r), ...int(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

describe('assertionSignature', () => {
  const key = { qx: P256_VECTOR_KEY.qx, qy: P256_VECTOR_KEY.qy };
  const assertion = {
    authenticatorData: hexToBytes(WEBAUTHN_VECTOR.authenticatorData),
    clientDataJSON: hexToBytes(WEBAUTHN_VECTOR.clientDataJSON),
    signature: der(BigInt(WEBAUTHN_VECTOR.r), BigInt(WEBAUTHN_VECTOR.s)),
  };

  it("encodes the vector's assertion as the account ran it", () => {
    expect(assertionSignature(key, WEBAUTHN_VECTOR.digest, assertion)).toBe(WEBAUTHN_VECTOR.signature);
  });

  it('sends a high s as the low one', () => {
    const high = { ...assertion, signature: der(BigInt(WEBAUTHN_VECTOR.r), P256_N - BigInt(WEBAUTHN_VECTOR.s)) };
    expect(assertionSignature(key, WEBAUTHN_VECTOR.digest, high)).toBe(WEBAUTHN_VECTOR.signature);
  });

  it('refuses an assertion of another challenge', () => {
    expect(() => assertionSignature(key, `0x${'11'.repeat(32)}`, assertion)).toThrow('different challenge');
  });

  it('refuses an assertion without user verification', () => {
    const data = Uint8Array.from(assertion.authenticatorData);
    data[32] = data[32]! & ~0x04;
    expect(() => assertionSignature(key, WEBAUTHN_VECTOR.digest, { ...assertion, authenticatorData: data })).toThrow('verify the user');
  });

  it("refuses a registration's clientData", () => {
    const json = new TextDecoder().decode(assertion.clientDataJSON).replace('webauthn.get', 'webauthn.create');
    const clientDataJSON = new TextEncoder().encode(json);
    expect(() => checkAssertion({ ...assertion, clientDataJSON }, hexToBytes(WEBAUTHN_VECTOR.digest))).toThrow('not a WebAuthn assertion');
  });

  it("refuses another key's signature", () => {
    // The P-256 generator: a valid point, and not the vector's key.
    const other = {
      qx: '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296',
      qy: '0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
    } as const;
    expect(() => assertionSignature(other, WEBAUTHN_VECTOR.digest, assertion)).toThrow("isn't this key's");
  });
});

describe('base64url', () => {
  it('round-trips bytes', () => {
    const bytes = Uint8Array.from({ length: 33 }, (_, i) => (i * 37) & 0xff);
    expect(bytesToHex(fromBase64url(base64url(bytes)))).toBe(bytesToHex(bytes));
    const client = JSON.parse(new TextDecoder().decode(hexToBytes(WEBAUTHN_VECTOR.clientDataJSON))) as { challenge: string };
    expect(base64url(hexToBytes(WEBAUTHN_VECTOR.digest))).toBe(client.challenge);
  });
});
