// A run's keys, made up as it starts and gone when it ends. They guard an anvil that lives for one run, so nothing here
// needs a real key, and none is ever printed.

import { randomBytes } from 'node:crypto';

import { p256 } from '@noble/curves/nist.js';
import { type Hex, bytesToHex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

export interface RunKeys {
  /** Pays the gas, and mints Store USDC. */
  readonly relayer: Hex;
  /** `StorePot`'s admin. */
  readonly admin: Hex;
  /** Holds `LISTER_ROLE`. */
  readonly lister: Hex;
  /** Holds `VERIFIER_ROLE`. */
  readonly verifier: Hex;
  /** Holds no role: the wrong key, and the anyone who may call `refund`. */
  readonly stranger: Hex;
  /** Pays the fake 0G Storage. */
  readonly storage: Hex;
  /** The Box's P-256 key. */
  readonly box: Hex;
  /** `STORE_PUBLISH_TOKEN`. */
  readonly publish: string;
}

export function makeKeys(): RunKeys {
  return {
    relayer: generatePrivateKey(),
    admin: generatePrivateKey(),
    lister: generatePrivateKey(),
    verifier: generatePrivateKey(),
    stranger: generatePrivateKey(),
    storage: generatePrivateKey(),
    box: bytesToHex(p256.utils.randomSecretKey()),
    publish: randomBytes(24).toString('hex'),
  };
}
