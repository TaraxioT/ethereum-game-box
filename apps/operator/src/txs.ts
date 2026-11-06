// Every write the site makes, as one list the transaction strip draws: `signed › sent › in block n › done`, or the
// reason it stopped. Each write goes through the relayer and is followed through its `/tx/:id`.
import type { Hash } from "viem";
import type { TxStatus, TxView } from "@egb/shared/names";

import { errorName } from "./errors.ts";
import { relayer } from "./relayer.ts";

export interface Tx {
  key: number;
  /** `DEPLOY`, `SAVE`, `REGISTER`, `RENEW`, `STATUS`, `ROTATE`. */
  kind: string;
  /** What it writes, for a person: `mumbai-01.gamebox.eth: location, games`. */
  subject: string;
  status: TxStatus;
  hash?: Hash;
  block?: number;
  /** The decoded error name, or the relayer's reason, on a failure. */
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

function update(tx: Tx, patch: Partial<Tx>): void {
  Object.assign(tx, patch);
  emit();
}

/** Thrown when a write ends `failed`. */
export class TxFailed extends Error {
  constructor(readonly tx: Tx) {
    super(tx.error ?? "failed");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Posts a relayed write (`send` returns the 202's `TxView`) and follows it to `done`. Resolves with the final view;
 *  rejects with `TxFailed`. */
export async function relayed(kind: string, subject: string, send: () => Promise<TxView>): Promise<TxView> {
  const tx: Tx = { key: nextKey++, kind, subject, status: "signed" };
  txs.unshift(tx);
  if (txs.length > 6) txs.pop();
  emit();
  let view: TxView;
  try {
    view = await send();
  } catch (err) {
    update(tx, { status: "failed", error: errorName(err) });
    throw new TxFailed(tx);
  }
  const show = (v: TxView) =>
    update(tx, {
      status: v.status,
      hash: v.hash,
      block: v.block,
      error: v.status === "failed" ? (v.revert ?? v.error ?? "failed") : undefined,
    });
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
