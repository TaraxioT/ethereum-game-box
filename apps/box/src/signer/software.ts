// A software P-256 key, for the simulator and the tests only: the Box's own key never leaves its HYP2003 token.
import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { BoxSigner } from "./signer.ts";

/** A signer for a 0x-prefixed 32-byte scalar. */
export function softwareSigner(secret: Hex): BoxSigner {
  const key = hexToBytes(secret);
  if (key.length !== 32) throw new Error("a software P-256 key is a 0x-prefixed 32-byte hex scalar");
  const point = p256.getPublicKey(key, false);
  const qx = bytesToHex(point.subarray(1, 33));
  const qy = bytesToHex(point.subarray(33));
  return {
    sign(digest) {
      const signature = p256.sign(hexToBytes(digest), key, { prehash: false, lowS: true, format: "compact" });
      return Promise.resolve({ r: bytesToHex(signature.subarray(0, 32)), s: bytesToHex(signature.subarray(32)) });
    },
    publicKey: () => Promise.resolve({ qx, qy }),
    stop() {},
  };
}
