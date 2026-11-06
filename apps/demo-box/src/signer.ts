// A software P-256 key: the demo Box's, in place of the HYP2003 token, and the agent's. It signs the raw 32-byte
// EIP-712 digest with no prehash and a low `s`, which is what the contracts check (they pass the digest itself to the
// EIP-7951 precompile). Web Crypto's ECDSA always hashes its input with SHA-256 first, so it can't make these
// signatures; `@noble/curves` can.

import { p256 } from '@noble/curves/nist.js';
import { rawSignature } from '@egb/shared/names';
import { type Hex, bytesToHex, hexToBytes } from 'viem';

export interface Signer {
  qx: Hex;
  qy: Hex;
  /** `(r, s)` over `digest` itself, with `s <= n/2`. */
  sign(digest: Hex): { r: Hex; s: Hex };
  /** The same signature in the raw form a `P256Account` takes: `r ‖ s`, 64 bytes. */
  raw(digest: Hex): Hex;
}

/** A signer for `secret`, a `0x`-prefixed 32-byte hex scalar, from the Worker secret `name`. */
export function p256Signer(secret: Hex, name = 'DEMO_BOX_P256_KEY'): Signer {
  const key = hexToBytes(secret);
  if (key.length !== 32) throw new Error(`${name} must be a 0x-prefixed 32-byte hex scalar`);
  const point = p256.getPublicKey(key, false);
  return {
    qx: bytesToHex(point.subarray(1, 33)),
    qy: bytesToHex(point.subarray(33)),
    sign(digest) {
      const signature = p256.sign(hexToBytes(digest), key, { prehash: false, lowS: true, format: 'compact' });
      return { r: bytesToHex(signature.subarray(0, 32)), s: bytesToHex(signature.subarray(32)) };
    },
    raw(digest) {
      const { r, s } = this.sign(digest);
      return rawSignature(BigInt(r), BigInt(s));
    },
  };
}
