// The two signature forms a `P256Account` takes, both over an EIP-712 digest from `messages.ts`:
// - raw: `r ‖ s` (64 bytes), ECDSA P-256 over the digest itself with no prehash (the HYP2003, a Worker key);
// - WebAuthn: a passkey assertion whose challenge is the digest, encoded as
//   `abi.encode(r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON)`, the fields of OpenZeppelin's
//   `WebAuthn.WebAuthnAuth` in order with no outer offset. The account checks `"type":"webauthn.get"`, the challenge,
//   and that the user was present and verified, so ask for `userVerification: 'required'`.
// Either way `s` must be low (at most n/2): `lowS` normalises it, and every encoder here applies it.
// `checkAssertion` checks an assertion the way the account will, so a bad one fails in the browser and not on chain.

import { type Hex, bytesToBigInt, bytesToHex, encodeAbiParameters, hexToBytes, numberToHex } from 'viem';

import { assertionHash, verifyP256 } from './p256.ts';

/** The order of P-256. */
export const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
/** The largest low `s`: n/2. */
export const P256_HALF_N = P256_N >> 1n;

/** A P-256 public key, as a `P256Account` and `P256AccountFactory.accountOf` take it. */
export interface P256PublicKey {
  qx: Hex;
  qy: Hex;
}

/** `s`, or `n - s` if it is high: the same signature in the one form the contracts accept. */
export function lowS(s: bigint): bigint {
  return s > P256_HALF_N ? P256_N - s : s;
}

/** The raw signature form: `r ‖ s`, 64 bytes, with `s` made low. */
export function rawSignature(r: bigint, s: bigint): Hex {
  return `0x${numberToHex(r, { size: 32 }).slice(2)}${numberToHex(lowS(s), { size: 32 }).slice(2)}`;
}

/** The challenge to pass to `navigator.credentials.get`: the digest's 32 bytes. The browser puts it in
 *  `clientDataJSON` as base64url without padding, which is what the account compares. */
export function webAuthnChallenge(digest: Hex): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hexToBytes(digest));
}

/** `r` and `s` (made low) from the DER signature an authenticator returns (`AuthenticatorAssertionResponse.signature`). */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  const fail = () => new Error('not a DER ECDSA signature');
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw fail();
  const read = (at: number): [bigint, number] => {
    if (der[at] !== 0x02) throw fail();
    const length = der[at + 1]!;
    if (length === 0 || length > 33 || at + 2 + length > der.length) throw fail();
    return [bytesToBigInt(der.subarray(at + 2, at + 2 + length)), at + 2 + length];
  };
  const [r, next] = read(2);
  const [s, end] = read(next);
  if (end !== der.length) throw fail();
  return { r, s: lowS(s) };
}

/** A passkey assertion's parts, as `navigator.credentials.get` returns them. */
export interface WebAuthnAssertion {
  /** `AuthenticatorAssertionResponse.authenticatorData`. */
  authenticatorData: Uint8Array | Hex;
  /** `AuthenticatorAssertionResponse.clientDataJSON`: the bytes, or their UTF-8 text. */
  clientDataJSON: Uint8Array | string;
  r: bigint;
  s: bigint;
}

const TYPE_FIELD = '"type":"webauthn.get"';
const CHALLENGE_FIELD = '"challenge":"';

/** Where `field` starts in the UTF-8 bytes of `json`. */
function byteIndex(json: string, field: string): bigint {
  const at = json.indexOf(field);
  if (at < 0) throw new Error(`clientDataJSON has no ${field}`);
  return BigInt(new TextEncoder().encode(json.slice(0, at)).length);
}

/** The WebAuthn signature form a `P256Account` takes, from an assertion. `s` is made low. */
export function encodeWebAuthnSignature(assertion: WebAuthnAssertion): Hex {
  const json =
    typeof assertion.clientDataJSON === 'string'
      ? assertion.clientDataJSON
      : new TextDecoder().decode(assertion.clientDataJSON);
  const authenticatorData =
    typeof assertion.authenticatorData === 'string' ? assertion.authenticatorData : bytesToHex(assertion.authenticatorData);
  return encodeAbiParameters(
    [
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
      { name: 'challengeIndex', type: 'uint256' },
      { name: 'typeIndex', type: 'uint256' },
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'string' },
    ],
    [
      numberToHex(assertion.r, { size: 32 }),
      numberToHex(lowS(assertion.s), { size: 32 }),
      byteIndex(json, CHALLENGE_FIELD),
      byteIndex(json, TYPE_FIELD),
      authenticatorData,
      json,
    ],
  );
}

/** The DER prefix of a P-256 public key's SubjectPublicKeyInfo, up to the uncompressed point. */
const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

/** The public key in a P-256 SubjectPublicKeyInfo (`AuthenticatorAttestationResponse.getPublicKey()`). */
export function p256PublicKeyFromSpki(spki: Uint8Array): P256PublicKey {
  const hex = bytesToHex(spki).slice(2);
  if (spki.length !== 91 || !hex.startsWith(P256_SPKI_PREFIX) || spki[26] !== 0x04) {
    throw new Error('not a P-256 public key');
  }
  return { qx: bytesToHex(spki.subarray(27, 59)), qy: bytesToHex(spki.subarray(59, 91)) };
}

/** Bytes as base64url without padding: how `clientDataJSON` carries the challenge, and how a credential id travels. */
export function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** `authenticatorData` flags: user present, user verified. */
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/** An assertion as `navigator.credentials.get` returns it, the signature still DER. */
export interface RawAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** `AuthenticatorAssertionResponse.signature`: DER. */
  signature: Uint8Array;
}

/** Checks an assertion of `challenge` the way `P256Account` will: `"type":"webauthn.get"`, the challenge, user present
 *  and verified, and (when `key` is given) the key's signature. Returns `r`, `s` (low) and the signed hash, from which
 *  `recoverP256Keys` finds the key when it isn't known. Throws, saying why, on the first failure. */
export function checkAssertion(assertion: RawAssertion, challenge: Uint8Array, key?: P256PublicKey) {
  const client = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON)) as { type?: unknown; challenge?: unknown };
  if (client.type !== 'webauthn.get') throw new Error('not a WebAuthn assertion');
  if (client.challenge !== base64url(challenge)) throw new Error('the passkey signed a different challenge');
  const flags = assertion.authenticatorData[32] ?? 0;
  if ((flags & (FLAG_UP | FLAG_UV)) !== (FLAG_UP | FLAG_UV)) {
    throw new Error("the authenticator didn't verify the user (user verification is required)");
  }
  const { r, s } = parseDerSignature(assertion.signature);
  const hash = assertionHash(assertion.authenticatorData, assertion.clientDataJSON);
  if (key && !verifyP256(key, r, s, hash)) throw new Error("the signature isn't this key's");
  return { r, s, hash };
}

/** The WebAuthn signature a `P256Account` takes for `digest`, from `key`'s assertion of it, checked first. */
export function assertionSignature(key: P256PublicKey, digest: Hex, assertion: RawAssertion): Hex {
  const { r, s } = checkAssertion(assertion, hexToBytes(digest), key);
  return encodeWebAuthnSignature({ authenticatorData: assertion.authenticatorData, clientDataJSON: assertion.clientDataJSON, r, s });
}
