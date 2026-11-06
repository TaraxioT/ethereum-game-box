// The Box's P-256 key, as the chain port uses it: it signs a 32-byte digest raw (no prehash) with a low `s`, which is
// what every Box-signed message (`Stake`, `Seat`, `Result`) needs. On the Box the key is the HYP2003 token's
// (`hyp2003.ts`); the simulator and the tests use a software key (`software.ts`).
import type { Hex } from "viem";

export interface P256Signature {
  readonly r: Hex;
  readonly s: Hex;
}

export interface BoxSigner {
  /** Signs `digest` (0x + 64 hex) as it is, with `s <= n/2`. Rejects when the key can't sign now. */
  sign(digest: Hex): Promise<P256Signature>;
  /** The key's public point. */
  publicKey(): Promise<{ readonly qx: Hex; readonly qy: Hex }>;
  stop(): void;
}
