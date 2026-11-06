// Signature checks, run before any gas is spent:
// - P-256 (`Execute`, `Result`): ECDSA over the raw EIP-712 digest with no prehash, low `s` only, the same check
//   `P256.sol` makes through the EIP-7951 precompile.
// - `ClaimName`: the badge's ECDSA signature, or ERC-1271 for a contract wallet.

import { p256 } from '@noble/curves/nist.js';
import { type Address, type Hex, concatHex, hexToBytes } from 'viem';
import { verifyHash } from 'viem/actions';

import type { Client } from './chain.ts';
import { Refusal } from './refusal.ts';

const HALF_N = p256.Point.CURVE().n / 2n;

/** Why `(r, s)` is not the P-256 key `(qx, qy)`'s signature of `digest`, or `null` if it is. */
export function p256Problem(digest: Hex, r: Hex, s: Hex, qx: Hex, qy: Hex): string | null {
  if (BigInt(s) > HALF_N) return 'high s: the contracts take s <= n/2 only';
  try {
    const signature = hexToBytes(concatHex([r, s]));
    const key = hexToBytes(concatHex(['0x04', qx, qy]));
    const ok = p256.verify(signature, hexToBytes(digest), key, { prehash: false, lowS: true, format: 'compact' });
    return ok ? null : 'not signed by the Box key';
  } catch {
    return 'not signed by the Box key';
  }
}

/** Throws a 401 unless `(r, s)` is the Box key's signature of `digest`. */
export function requireP256(digest: Hex, r: Hex, s: Hex, qx: Hex, qy: Hex): void {
  const problem = p256Problem(digest, r, s, qx, qy);
  if (problem) throw new Refusal(401, problem);
}

/** Throws a 401 unless `signature` is `badge`'s over `digest`: ECDSA recovery first, then ERC-1271. */
export async function requireBadgeSignature(client: Client, badge: Address, digest: Hex, signature: Hex) {
  const ok = await verifyHash(client, { address: badge, hash: digest, signature, mode: 'eoa' }).catch(() => false);
  if (!ok) throw new Refusal(401, 'not signed by the badge');
}
