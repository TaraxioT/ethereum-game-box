// Watching one record across a Box and its pop-ups: the operator writes `location` on the operator site, and the new
// value shows on `mumbai-01` and on every pop-up linked to its record, at the same block. `track` is the pure part:
// it remembers each name's value and the block where it was first seen changing.
import { type Address, type Hash, type PublicClient, getAbiItem } from "viem";
import { permissionedResolverAbi } from "@egb/shared/names";

import { LOG_CHUNK } from "./config.ts";

export interface Watched {
  value: string | null;
  /** The head block at which the value was first seen different from the one before; null if it hasn't changed. */
  changedAt: bigint | null;
}

/** Folds one round of reads (name → value) at `block` into what was seen before. */
export function track(before: ReadonlyMap<string, Watched>, reads: ReadonlyMap<string, string | null>, block: bigint): Map<string, Watched> {
  const out = new Map<string, Watched>();
  for (const [name, value] of reads) {
    const prev = before.get(name);
    if (!prev) out.set(name, { value, changedAt: null });
    else if (prev.value !== value) out.set(name, { value, changedAt: block });
    else out.set(name, prev);
  }
  return out;
}

/** The last write of `key` to a record, from the resolver's `TextUpdated` events. */
export interface TextWrite {
  value: string;
  block: bigint;
  hash: Hash;
}

const TEXT_UPDATED = getAbiItem({ abi: permissionedResolverAbi, name: "TextUpdated" });

/** The latest `TextUpdated` of `key` on record `recordId`, within the last `LOG_CHUNK` blocks, or null. */
export async function lastTextWrite(
  client: PublicClient,
  resolver: Address,
  recordId: bigint,
  key: string,
  head: bigint,
): Promise<TextWrite | null> {
  const logs = await client.getLogs({
    address: resolver,
    event: TEXT_UPDATED,
    args: { recordId, keyHash: key },
    fromBlock: head > LOG_CHUNK ? head - LOG_CHUNK : 0n,
    toBlock: head,
    strict: true,
  });
  const last = logs.at(-1);
  return last && last.blockNumber !== null && last.transactionHash !== null
    ? { value: last.args.value, block: last.blockNumber, hash: last.transactionHash }
    : null;
}
