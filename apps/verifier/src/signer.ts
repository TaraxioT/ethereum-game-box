// The verifier's key. Only the Worker holds it, and the container never sees what it signs.

import { type StoreVerdict, type StoreVoid, storeVerdictTypedData, storeVoidTypedData } from '@egb/shared/store';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface PaySigner {
  readonly address: Address;
  signVerdict(verdict: StoreVerdict): Promise<Hex>;
  signVoid(voiding: StoreVoid): Promise<Hex>;
}

/** Signs for the `StorePot` that `pot` returns, read when it signs: the Worker runs before the pot is deployed. */
export function verifierSigner(key: Hex, pot: () => Address): PaySigner {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signVerdict: (verdict) => account.signTypedData(storeVerdictTypedData(verdict, pot())),
    signVoid: (voiding) => account.signTypedData(storeVoidTypedData(voiding, pot())),
  };
}
