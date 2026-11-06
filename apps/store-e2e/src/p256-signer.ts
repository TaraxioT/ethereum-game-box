// The Box's signer daemon with a software key: it speaks what `deploy/p256-signer/hyp2003_signer.py --serve` speaks, so the
// Box runs its real `processSigner`. `EGB_E2E_BOX_KEY` is the key, a run's own.

import { createInterface } from 'node:readline';

import { p256 } from '@noble/curves/nist.js';
import { bytesToHex, hexToBytes } from 'viem';

const key = hexToBytes((process.env.EGB_E2E_BOX_KEY ?? '') as `0x${string}`);
const point = p256.getPublicKey(key, false);

const say = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);

say({ ready: true, qx: bytesToHex(point.subarray(1, 33)), qy: bytesToHex(point.subarray(33)) });

for await (const line of createInterface({ input: process.stdin })) {
  const { id, digest } = JSON.parse(line) as { id: number; digest: `0x${string}` };
  const signature = p256.sign(hexToBytes(digest), key, { prehash: false, lowS: true, format: 'compact' });
  say({ id, r: bytesToHex(signature.subarray(0, 32)), s: bytesToHex(signature.subarray(32)) });
}
