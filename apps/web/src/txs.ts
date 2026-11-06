// Every write the site makes, as one list the transaction strip draws: `signed › sent › in block n › done`, or the
// decoded error on a failure. A relayed write is followed through the relayer's `/tx/:id`; a direct one (the badge's
// own transaction) through its receipt.
import type { Hash, PublicClient } from "viem";
import type { TxStatus, TxStep, TxView } from "@egb/shared/names";

import { errorName } from "./errors.ts";
import { ApiRefusal, relayer } from "./relayer.ts";

export interface Tx {
  key: number;
  /** `CLAIM`, `DRIP`, `REVOKE`, `POP-UP`, `RESULT`. */
  kind: string;
  /** What it writes, for a person: `judge-7f2.gamebox.eth`. */
  subject: string;
  status: TxStatus;
  hash?: Hash;
  block?: number;
  /** The decoded error name (or the relayer's reason) on a failure. */
  error?: string;
}

const txs: Tx[] = [];
const listeners = new Set<(txs: readonly Tx[]) => void>();
let nextKey = 1;

export function onTxs(fn: (txs: readonly Tx[]) => void): () => void {
  listeners.add(fn);
  fn(txs);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn(txs);
}

function start(kind: string, subject: string): Tx {
  const tx: Tx = { key: nextKey++, kind, subject, status: "signed" };
  txs.unshift(tx);
  if (txs.length > 8) txs.pop();
  emit();
  return tx;
}

function update(tx: Tx, patch: Partial<Tx>): void {
  Object.assign(tx, patch);
  emit();
}

/** Thrown when a tracked write ends `failed`. */
export class TxFailed extends Error {
  constructor(readonly tx: Tx) {
    super(tx.error ?? "failed");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Folds a relayer step (a request, or a claim's primary-name transaction) into a strip entry. */
export function fromView(step: TxStep): Partial<Tx> {
  return {
    status: step.status,
    hash: step.hash,
    block: step.block,
    error: step.status === "failed" ? (step.revert ?? step.error ?? "failed") : undefined,
  };
}

/** Sends a relayed write (`send` posts it and gets the 202's `TxView`), then follows it to `done`. Resolves with the
 * final view; rejects with `TxFailed`. */
export async function relayed(kind: string, subject: string, send: () => Promise<TxView>): Promise<TxView> {
  const tx = start(kind, subject);
  let view: TxView;
  try {
    view = await send();
  } catch (err) {
    update(tx, { status: "failed", error: err instanceof ApiRefusal ? err.message : errorName(err) });
    throw new TxFailed(tx);
  }
  // A claim's primary-name transaction is its own row, under the same request.
  let primary: Tx | null = null;
  const show = (v: TxView) => {
    update(tx, fromView(v));
    if (v.primaryName) {
      primary ??= start("PRIMARY NAME", `getEnsName → ${subject}`);
      update(primary, fromView(v.primaryName));
    }
  };
  show(view);
  while (view.status !== "done" && view.status !== "failed") {
    await sleep(2_000);
    try {
      view = await relayer.tx(view.id);
      show(view);
    } catch {
      // A missed poll; the next one catches up.
    }
  }
  if (view.status === "failed") throw new TxFailed(tx);
  return view;
}

/** Follows a transaction the site sent itself: `sign` signs and sends it and returns the hash. */
export async function direct(
  client: PublicClient,
  kind: string,
  subject: string,
  sign: () => Promise<Hash>,
): Promise<{ hash: Hash; block: bigint }> {
  const tx = start(kind, subject);
  try {
    const hash = await sign();
    update(tx, { status: "sent", hash });
    const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 2_000 });
    update(tx, { status: "in-block", block: Number(receipt.blockNumber) });
    if (receipt.status !== "success") {
      update(tx, { status: "failed", error: "reverted" });
      throw new TxFailed(tx);
    }
    // Done once the head is past the receipt's block, as the relayer counts it.
    while ((await client.getBlockNumber({ cacheTime: 0 })) <= receipt.blockNumber) await sleep(2_000);
    update(tx, { status: "done" });
    return { hash, block: receipt.blockNumber };
  } catch (err) {
    if (err instanceof TxFailed) throw err;
    update(tx, { status: "failed", error: errorName(err) });
    throw new TxFailed(tx);
  }
}
