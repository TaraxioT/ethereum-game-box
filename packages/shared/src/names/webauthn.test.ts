// The parts of webauthn.ts the vectors don't reach: reading a passkey's public key, and refusing malformed input.

import { generateKeyPairSync } from 'node:crypto';

import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { encodeWebAuthnSignature, lowS, P256_HALF_N, P256_N, p256PublicKeyFromSpki } from './webauthn.ts';

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
