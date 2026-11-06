// Where an audit record goes once its pot is closed. Behind this interface so a store can change, and the judgement's
// retries run the same on a fake.

import type { Hex } from 'viem';

export interface Landed {
  /** The file's root on the store. */
  readonly root: Hex;
  /** The transaction that paid for it, or null if the file was already there. */
  readonly tx: Hex | null;
}

export interface Paying {
  /** The transaction an earlier try paid with, or null. */
  readonly paid: Hex | null;
  /** Keeps a payment, the moment it leaves. */
  onPaid(tx: Hex): Promise<void>;
}

export interface AuditStore {
  /** Stores `text` exactly, or throws. Safe to call again for the same text, with `paying` saying what was paid: however
   *  a try ends, a retry pays only if nothing it knows of can still bring the file. */
  put(text: string, paying: Paying): Promise<Landed>;
}
