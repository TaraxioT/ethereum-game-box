// Ethereum addresses from secp256k1 keys, and recovering the key that made a chip's DER signature.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type Address = `0x${string}`;

/** EIP-55 mixed-case form of a 20-byte hex address. */
function checksum(address: string): Address {
  const lower = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error(`not an address: ${address}`);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out as Address;
}

/** The address of an uncompressed (65-byte, 04…) public key. */
export function addressOf(publicKey: Uint8Array): Address {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("not an uncompressed public key");
  return checksum(bytesToHex(keccak_256(publicKey.subarray(1)).subarray(12)));
}

/** The addresses that could have made a DER signature over `digest` (one per recovery bit). */
export function signers(digest: Uint8Array, derHex: string): Address[] {
  const sig = secp256k1.Signature.fromBytes(hexToBytes(derHex), "der");
  const out: Address[] = [];
  for (const bit of [0, 1]) {
    try {
      out.push(addressOf(sig.addRecoveryBit(bit).recoverPublicKey(digest).toBytes(false)));
    } catch {
      // No point on the curve for this recovery bit.
    }
  }
  return out;
}
