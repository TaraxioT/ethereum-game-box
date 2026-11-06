// Passkeys (WebAuthn): make one, sign in with one, and sign a digest with one. A passkey is an operator's P-256 key;
// its `P256Account` is `P256AccountFactory.accountOf(qx, qy)`. Only the public key and the credential id are kept, in
// this browser's localStorage; the private key never leaves the authenticator.
import { type Hex, hexToBytes } from "viem";
import {
  type P256PublicKey,
  encodeWebAuthnSignature,
  p256PublicKeyFromSpki,
  parseDerSignature,
  webAuthnChallenge,
} from "@egb/shared/names";

import { rpId } from "./config.ts";
import { assertionHash, recoverKeys, verifies } from "./p256.ts";

/** A passkey as the site keeps it: its credential id (base64url) and its public key. */
export interface Passkey extends P256PublicKey {
  id: string;
}

const STORE = "egb.operator.passkey";
const ES256 = -7;
/** `authenticatorData` flags: user present, user verified. */
const UP = 0x01;
const UV = 0x04;

export function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The passkey this browser signed in with last, or null. */
export function storedPasskey(): Passkey | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? "null") as Passkey | null;
    return value && typeof value.id === "string" && typeof value.qx === "string" && typeof value.qy === "string"
      ? { id: value.id, qx: value.qx, qy: value.qy }
      : null;
  } catch {
    return null;
  }
}

export function rememberPasskey(passkey: Passkey): void {
  localStorage.setItem(STORE, JSON.stringify({ id: passkey.id, qx: passkey.qx, qy: passkey.qy }));
}

export function forgetPasskey(): void {
  localStorage.removeItem(STORE);
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** Makes a passkey: ES256, user verification required, discoverable so it can sign in on its own. */
export async function createPasskey(name: string): Promise<Passkey> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId(), name: "Game Box operator" },
      user: { id: random(16), name, displayName: name },
      challenge: random(32),
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was made");
  const response = credential.response as AuthenticatorAttestationResponse;
  if (response.getPublicKeyAlgorithm() !== ES256) throw new Error("That passkey isn't a P-256 (ES256) key");
  const flags = new Uint8Array(response.getAuthenticatorData())[32] ?? 0;
  if ((flags & UV) === 0) throw new Error("The authenticator didn't verify you (user verification is required)");
  const spki = response.getPublicKey();
  if (!spki) throw new Error("The browser didn't return the passkey's public key");
  return { id: base64url(new Uint8Array(credential.rawId)), ...p256PublicKeyFromSpki(new Uint8Array(spki)) };
}

/** One assertion's parts, as `navigator.credentials.get` returns them. */
export interface Assertion {
  id: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER. */
  signature: Uint8Array;
}

async function assert(challenge: Uint8Array<ArrayBuffer>, id?: string): Promise<Assertion> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: rpId(),
      allowCredentials: id ? [{ type: "public-key", id: fromBase64url(id) }] : [],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey answered");
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: base64url(new Uint8Array(credential.rawId)),
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
  };
}

/** Checks an assertion the way `P256Account` will (type, challenge, user present and verified, the key's signature),
 *  so a bad one fails here and not on chain. Returns `r` and `s` (low). */
export function checkAssertion(assertion: Omit<Assertion, "id">, challenge: Uint8Array, key?: P256PublicKey) {
  const client = JSON.parse(new TextDecoder().decode(assertion.clientDataJSON)) as { type?: string; challenge?: string };
  if (client.type !== "webauthn.get") throw new Error("Not a WebAuthn assertion");
  if (client.challenge !== base64url(challenge)) throw new Error("The passkey signed a different challenge");
  const flags = assertion.authenticatorData[32] ?? 0;
  if ((flags & (UP | UV)) !== (UP | UV)) throw new Error("The authenticator didn't verify you (user verification is required)");
  const { r, s } = parseDerSignature(assertion.signature);
  const hash = assertionHash(assertion.authenticatorData, assertion.clientDataJSON);
  if (key && !verifies(key, r, s, hash)) throw new Error("The signature isn't this passkey's");
  return { r, s, hash };
}

/** The signature a `P256Account` takes for `digest`, from the passkey's assertion of it. */
export function assertionSignature(passkey: P256PublicKey, digest: Hex, assertion: Omit<Assertion, "id">): Hex {
  const { r, s } = checkAssertion(assertion, hexToBytes(digest), passkey);
  return encodeWebAuthnSignature({
    authenticatorData: assertion.authenticatorData,
    clientDataJSON: assertion.clientDataJSON,
    r,
    s,
  });
}

/** Signs an EIP-712 digest with the passkey: one prompt, the digest as the challenge. */
export async function signDigest(passkey: Passkey, digest: Hex): Promise<Hex> {
  const assertion = await assert(webAuthnChallenge(digest), passkey.id);
  if (assertion.id !== passkey.id) throw new Error("A different passkey answered");
  return assertionSignature(passkey, digest, assertion);
}

/** The outcome of a sign-in: the passkey, or (on a device that has never seen it) the two keys its signature could be
 *  from, which a second signature tells apart. */
export type SignIn = { passkey: Passkey } | { id: string; candidates: P256PublicKey[] };

/** Signs in with any passkey of this site. A `get` never returns the public key, so it is the one this browser kept
 *  for that credential, or recovered from the signature: `pick` chooses among the candidates (say, the one whose
 *  account exists), and returns null if it can't. */
export async function signIn(pick: (keys: P256PublicKey[]) => Promise<P256PublicKey | null>): Promise<SignIn> {
  const challenge = random(32);
  const assertion = await assert(challenge);
  const stored = storedPasskey();
  if (stored?.id === assertion.id) {
    checkAssertion(assertion, challenge, stored);
    return { passkey: stored };
  }
  const { r, s, hash } = checkAssertion(assertion, challenge);
  const candidates = recoverKeys(r, s, hash);
  const key = candidates.length === 1 ? candidates[0]! : await pick(candidates);
  return key ? { passkey: { id: assertion.id, ...key } } : { id: assertion.id, candidates };
}

/** The second signature of a sign-in on a new device: the key both signatures recover to. */
export async function confirmSignIn(id: string, candidates: P256PublicKey[]): Promise<Passkey> {
  const challenge = random(32);
  const { r, s, hash } = checkAssertion(await assert(challenge, id), challenge);
  const key = candidates.find((candidate) => verifies(candidate, r, s, hash));
  if (!key) throw new Error("The two signatures don't agree on a key");
  return { id, ...key };
}
