// The audit record. Its keccak256, over the exact JSON text, goes on chain in the signed `Verdict` or `Void`, so that
// exact text is what must reach 0G Storage. It is built once and kept as text, never serialized again.

import { type AuditRecord, jsonTextHash } from '@egb/shared/store';
import type { Hex } from 'viem';

export interface SealedRecord {
  readonly text: string;
  readonly hash: Hex;
}

export function sealRecord(record: Omit<AuditRecord, 'v'>): SealedRecord {
  const text = JSON.stringify({ v: 1, ...record } satisfies AuditRecord);
  return { text, hash: jsonTextHash(text) };
}
