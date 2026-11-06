// Where an audit record goes once its pot is closed. Behind this interface so a store can change, and the judgement's
// retries run the same on a fake.

import type { Hex } from 'viem';

export interface Landed {
  /** The file's root on the store. */
  readonly root: Hex;
  /** The transaction that paid for it, or null if the file was already there. */
  readonly tx: Hex | null;
}

export interface AuditStore {
  /** Stores `text` exactly, or throws. Safe to call again for the same text. */
  put(text: string): Promise<Landed>;
}
