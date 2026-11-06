// What the Box asks of a HaLo chip, with the checks it relies on. The same code runs against a real chip on a station
// and against the fake receiver's simulated badges. Key 1 (the wallet) is never asked to sign: it signs anything,
// money included, so it is kept for stakes signed over a digest the Box built, which this pass doesn't do.
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { addressOf, signers, type Address } from "./eth.ts";
import { VerifyError } from "./errors.ts";
import type { HaloExec } from "./halo-exec.ts";

/** Key 2: the factory-attested identity key. It refuses raw digests; it signs `sign_random` rolls. */
const KEY_IDENTITY = 2;

export interface ChipKeys {
  /** Key 1's address: the chip's wallet. Recorded, never used to sign here. */
  readonly key1: Address;
  /** Key 2's address: the badge's identity. */
  readonly key2: Address;
}

export interface Roll {
  /** The uint32 games use: payload bytes 4..8, right after the counter. */
  readonly value: number;
  /** The chip's sign_random counter: a re-roll shows. */
  readonly counter: number;
  /** The 32 signed bytes (counter + 28 random), hex. */
  readonly payload: string;
}

const field = (res: unknown, name: string): unknown => (typeof res === "object" && res !== null ? (res as Record<string, unknown>)[name] : undefined);
const hexField = (res: unknown, name: string): string => {
  const v = field(res, name);
  if (typeof v !== "string" || !/^(?:[0-9a-fA-F]{2})+$/.test(v)) throw new VerifyError(`the chip's ${name} is missing or not hex`);
  return v;
};

/** get_pkeys: both keys' addresses, computed here from the public keys the chip sent. */
export async function readKeys(exec: HaloExec): Promise<ChipKeys> {
  const res = await exec({ name: "get_pkeys" });
  const keys = field(res, "publicKeys") as Record<string, unknown> | undefined;
  const key = (n: number): Address => {
    const hex = keys?.[n];
    if (typeof hex !== "string") throw new VerifyError(`the chip sent no key ${n}`);
    try {
      return addressOf(hexToBytes(hex));
    } catch {
      throw new VerifyError(`the chip's key ${n} isn't a public key`);
    }
  };
  return { key1: key(1), key2: key(KEY_IDENTITY) };
}

/** The digest a chip signs for `sign_random`: SHA-256("\x19Attest counter pk<key>:\n" ‖ payload). */
export function randomDigest(keyNo: number, payload: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`\x19Attest counter pk${keyNo}:\n`);
  const msg = new Uint8Array(prefix.length + payload.length);
  msg.set(prefix);
  msg.set(payload, prefix.length);
  return sha256(msg);
}

/**
 * Key 2's sign_random, checked on the Pi: the signature over the payload must recover to `identity` (the roster's
 * key-2 address for this UID), and the counter it reports must be the one inside the payload. Anything else is a
 * VerifyError: the tap fails rather than trust the chip's number.
 */
export async function rollRandom(exec: HaloExec, identity: Address): Promise<Roll> {
  const res = await exec({ name: "sign_random", keyNo: KEY_IDENTITY });
  const payloadHex = hexField(res, "payload").toLowerCase();
  const payload = hexToBytes(payloadHex);
  if (payload.length !== 32) throw new VerifyError("the roll's payload is not 32 bytes");
  let found: Address[];
  try {
    found = signers(randomDigest(KEY_IDENTITY, payload), hexField(res, "signature"));
  } catch {
    throw new VerifyError("the roll's signature doesn't parse");
  }
  if (!found.some((a) => a.toLowerCase() === identity.toLowerCase())) {
    throw new VerifyError(`the roll was signed by another key, not this badge's ${identity}`);
  }
  const view = new DataView(payload.buffer, payload.byteOffset, 32);
  const counter = view.getUint32(0);
  if (field(res, "counter") !== counter) throw new VerifyError("the roll's counter doesn't match its payload");
  return { value: view.getUint32(4), counter, payload: payloadHex };
}
