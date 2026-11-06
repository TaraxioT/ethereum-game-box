// Signature checks, run before any gas is spent:
// - P-256 (`Execute`, `Result`): ECDSA over the raw EIP-712 digest with no prehash, low `s` only, the same check
//   `P256.sol` makes through the EIP-7951 precompile.
// - A `P256Account`'s `Execute`: that raw form (64 bytes), or a passkey's WebAuthn assertion, checked the way
//   OpenZeppelin's `WebAuthn.verify` checks it, with user verification required.
// - `ClaimName` and the primary-name consent: the badge's ECDSA signature, or ERC-1271 for a contract account, the way
//   OpenZeppelin's `SignatureChecker` decides between them (by whether the badge has code).

import { p256 } from '@noble/curves/nist.js';
import {
  type Address,
  type Hex,
  concatBytes,
  concatHex,
  decodeAbiParameters,
  hexToBytes,
  isAddressEqual,
  parseAbi,
  recoverAddress,
  sha256,
  size,
  slice,
} from 'viem';

import type { Client } from './chain.ts';
import { Refusal } from './refusal.ts';

const N = p256.Point.CURVE().n;
const HALF_N = N / 2n;

/** Why `(r, s)` is not the P-256 key `(qx, qy)`'s signature of `digest`, or `null` if it is. */
export function p256Problem(digest: Hex, r: Hex, s: Hex, qx: Hex, qy: Hex, signer = 'the Box key'): string | null {
  if (BigInt(s) > HALF_N) return 'high s: the contracts take s <= n/2 only';
  try {
    const signature = hexToBytes(concatHex([r, s]));
    const key = hexToBytes(concatHex(['0x04', qx, qy]));
    const ok = p256.verify(signature, hexToBytes(digest), key, { prehash: false, lowS: true, format: 'compact' });
    return ok ? null : `not signed by ${signer}`;
  } catch {
    return `not signed by ${signer}`;
  }
}

/** Throws a 401 unless `(r, s)` is the Box key's signature of `digest`. */
export function requireP256(digest: Hex, r: Hex, s: Hex, qx: Hex, qy: Hex): void {
  const problem = p256Problem(digest, r, s, qx, qy);
  if (problem) throw new Refusal(401, problem);
}

/** Whether `(qx, qy)` is a point on P-256: a key an account can be bound to. */
export function isP256Point(qx: Hex, qy: Hex): boolean {
  try {
    p256.Point.fromBytes(hexToBytes(concatHex(['0x04', qx, qy]))).assertValidity();
    return true;
  } catch {
    return false;
  }
}

const WEBAUTHN_AUTH = [
  { name: 'r', type: 'bytes32' },
  { name: 's', type: 'bytes32' },
  { name: 'challengeIndex', type: 'uint256' },
  { name: 'typeIndex', type: 'uint256' },
  { name: 'authenticatorData', type: 'bytes' },
  // A string on chain; read as bytes here, since both indices count bytes.
  { name: 'clientDataJSON', type: 'bytes' },
] as const;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

const utf8 = (text: string) => new TextEncoder().encode(text);
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Whether `bytes` holds `expected` at `at`. */
function holds(bytes: Uint8Array, at: bigint, expected: Uint8Array): boolean {
  if (at + BigInt(expected.length) > BigInt(bytes.length)) return false;
  const start = Number(at);
  return expected.every((byte, i) => bytes[start + i] === byte);
}

/** Why `signature` is not a passkey assertion of `digest` by `(qx, qy)` that a `P256Account` takes, or `null`. */
export function webAuthnProblem(digest: Hex, signature: Hex, qx: Hex, qy: Hex): string | null {
  let auth;
  try {
    auth = decodeAbiParameters(WEBAUTHN_AUTH, signature);
  } catch {
    return 'not a raw or WebAuthn signature';
  }
  const [r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON] = auth;
  const authData = hexToBytes(authenticatorData);
  const json = hexToBytes(clientDataJSON);
  if (authData.length < 37) return 'WebAuthn: authenticatorData is too short';
  if (!holds(json, typeIndex, utf8('"type":"webauthn.get"'))) return 'WebAuthn: not a webauthn.get assertion';
  if (!holds(json, challengeIndex, utf8(`"challenge":"${base64url(hexToBytes(digest))}"`))) {
    return 'WebAuthn: the challenge is not the digest';
  }
  const flags = authData[32]!;
  if (!(flags & FLAG_UP)) return 'WebAuthn: the user was not present';
  if (!(flags & FLAG_UV)) return 'WebAuthn: the user was not verified';
  if (flags & FLAG_BS && !(flags & FLAG_BE)) return 'WebAuthn: backed up but not backup-eligible';
  if (BigInt(r) === 0n || BigInt(r) >= N || BigInt(s) === 0n) return "not signed by the account's key";
  const hash = sha256(concatBytes([authData, sha256(json, 'bytes')]));
  return p256Problem(hash, r, s, qx, qy, "the account's key");
}

/** Why `signature` (raw `r ‖ s`, or WebAuthn) is not the `P256Account` key `(qx, qy)`'s over `digest`, or `null`. */
export function accountSignatureProblem(digest: Hex, signature: Hex, qx: Hex, qy: Hex): string | null {
  if (size(signature) === 64) {
    return p256Problem(digest, slice(signature, 0, 32), slice(signature, 32), qx, qy, "the account's key");
  }
  return webAuthnProblem(digest, signature, qx, qy);
}

const erc1271Abi = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);
const ERC1271_MAGIC = '0x1626ba7e';

/** Throws a 401 unless `signature` is `badge`'s over `digest`: ERC-1271 if the badge has code, else ECDSA. */
export async function requireBadgeSignature(client: Client, badge: Address, digest: Hex, signature: Hex) {
  const code = await client.getCode({ address: badge });
  const ok =
    code && code !== '0x'
      ? (await client
          .readContract({ address: badge, abi: erc1271Abi, functionName: 'isValidSignature', args: [digest, signature] })
          .catch(() => null)) === ERC1271_MAGIC
      : await recoverAddress({ hash: digest, signature }).then(
          (signer) => isAddressEqual(signer, badge),
          () => false,
        );
  if (!ok) throw new Refusal(401, 'not signed by the badge');
}
