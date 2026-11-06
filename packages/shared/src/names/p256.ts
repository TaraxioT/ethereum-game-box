// P-256 arithmetic the browser's WebAuthn API leaves out: the hash an authenticator signs, the public keys a signature
// recovers to (a passkey's `get` never returns its key), a signature check, and a public key read from text such as a
// Box's `boxKey` record (`0x04` + x + y). Every check uses no prehash, as the contracts' EIP-7951 precompile does.

import { p256 } from '@noble/curves/nist.js';
import { type Hex, bytesToHex, concatBytes, hexToBytes, isHex, sha256 } from 'viem';

import type { P256PublicKey } from './webauthn.ts';

/** What an authenticator signs for an assertion: `sha256(authenticatorData ‖ sha256(clientDataJSON))`. */
export function assertionHash(authenticatorData: Uint8Array, clientDataJSON: Uint8Array): Uint8Array {
  return sha256(concatBytes([authenticatorData, sha256(clientDataJSON, 'bytes')]), 'bytes');
}

/** `0x04` + x + y: an uncompressed point, as the `boxKey` record writes a key. */
export function p256PublicKeyHex(key: P256PublicKey): Hex {
  return bytesToHex(concatBytes([new Uint8Array([4]), hexToBytes(key.qx), hexToBytes(key.qy)]));
}

function fromPoint(bytes: Uint8Array): P256PublicKey {
  return { qx: bytesToHex(bytes.subarray(1, 33)), qy: bytesToHex(bytes.subarray(33, 65)) };
}

/** The (at most two) public keys for which `(r, s)` is a signature of `hash`. Either `s` gives the same two. */
export function recoverP256Keys(r: bigint, s: bigint, hash: Uint8Array): P256PublicKey[] {
  const keys: P256PublicKey[] = [];
  for (const bit of [0, 1]) {
    try {
      keys.push(fromPoint(new p256.Signature(r, s).addRecoveryBit(bit).recoverPublicKey(hash).toBytes(false)));
    } catch {
      // No point for this recovery bit.
    }
  }
  return keys;
}

/** Whether `(r, s)` is `key`'s signature of `hash` (no prehash; a high or low `s`). */
export function verifyP256(key: P256PublicKey, r: bigint, s: bigint, hash: Uint8Array): boolean {
  try {
    const signature = new p256.Signature(r, s).toBytes('compact');
    return p256.verify(signature, hash, hexToBytes(p256PublicKeyHex(key)), { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

/** The same key, compared by value. */
export function sameP256Key(a: P256PublicKey, b: P256PublicKey): boolean {
  return a.qx.toLowerCase() === b.qx.toLowerCase() && a.qy.toLowerCase() === b.qy.toLowerCase();
}

/** A P-256 public key written as `0x04` + x + y or x + y (with or without `0x`, any case, spaces round it), or
 *  `null` unless it is a point on the curve. */
export function parseP256PublicKey(text: string): P256PublicKey | null {
  let hex = text.trim().toLowerCase();
  if (!hex.startsWith('0x')) hex = `0x${hex}`;
  if (!isHex(hex)) return null;
  if (hex.length === 2 + 128) hex = `0x04${hex.slice(2)}`;
  if (hex.length !== 2 + 130) return null;
  try {
    p256.Point.fromBytes(hexToBytes(hex as Hex)).assertValidity();
  } catch {
    return null;
  }
  return fromPoint(hexToBytes(hex as Hex));
}
