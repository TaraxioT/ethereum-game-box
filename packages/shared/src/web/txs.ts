// Every write a site makes, as one list its transaction strip draws: `signed › sent › in block n › done`, or the
// decoded error where it stopped. A relayed write is followed through the relayer's `/tx/:id`; a direct one (a badge's
// own transaction) through its receipt. A claim's primary-name transaction is its own row.

import type { Hash, PublicClient } from 'viem';

import type { TxStatus, TxStep, TxView } from '../names/api.ts';
import { errorName } from './errors.ts';
import { ApiRefusal } from './relayer.ts';

export interface Tx {
  key: number;
  /** `CLAIM`, `SAVE`, `DEPLOY`, …: what kind of write, in a word. */
  kind: string;
  /** What it writes, for a person: `mumbai-01.gamebox.eth: location`. */
  subject: string;
  status: TxStatus;
  hash?: Hash;
  block?: number;
  /** The decoded error name, or the relayer's reason, on a failure. */
  error?: string;
}

/** Thrown when a tracked write ends `failed`. */
export class TxFailed extends Error {
  readonly tx: Tx;

  constructor(tx: Tx) {
    super(tx.error ?? 'failed');
    this.tx = tx;
  }
}

/** A relayer step (a request, or a claim's primary-name transaction) as a strip row's fields. */
export function fromView(step: TxStep): Partial<Tx> {
  return {
    status: step.status,
    hash: step.hash,
    block: step.block,
    error: step.status === 'failed' ? (step.revert ?? step.error ?? 'failed') : undefined,
  };
}

export interface TxLogOptions {
  /** The relayer's `GET /tx/:id`. */
  follow: (id: string) => Promise<TxView>;
  /** How many rows to keep, newest first. */
  keep?: number;
  pollMs?: number;
}

export type TxLog = ReturnType<typeof txLog>;

/** A site's list of writes. */
export function txLog({ follow, keep = 8, pollMs = 2_000 }: TxLogOptions) {
  const txs: Tx[] = [];
  const listeners = new Set<(txs: readonly Tx[]) => void>();
  let nextKey = 1;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const emit = () => {
    for (const fn of listeners) fn(txs);
  };
  const start = (kind: string, subject: string): Tx => {
    const tx: Tx = { key: nextKey++, kind, subject, status: 'signed' };
    txs.unshift(tx);
    if (txs.length > keep) txs.pop();
    emit();
    return tx;
  };
  const update = (tx: Tx, patch: Partial<Tx>) => {
    Object.assign(tx, patch);
    emit();
  };

  return {
    /** Calls `fn` with the rows now and after every change; returns an unsubscribe. */
    onTxs(fn: (txs: readonly Tx[]) => void): () => void {
      listeners.add(fn);
      fn(txs);
      return () => listeners.delete(fn);
    },

    /** Posts a relayed write (`send` returns the 202's `TxView`) and follows it to `done`. Resolves with the final
     *  view; rejects with `TxFailed`. */
    async relayed(kind: string, subject: string, send: () => Promise<TxView>): Promise<TxView> {
      const tx = start(kind, subject);
      let view: TxView;
      try {
        view = await send();
      } catch (err) {
        update(tx, { status: 'failed', error: err instanceof ApiRefusal ? err.message : errorName(err) });
        throw new TxFailed(tx);
      }
      let primary: Tx | null = null;
      const show = (v: TxView) => {
        update(tx, fromView(v));
        if (v.primaryName) {
          primary ??= start('PRIMARY NAME', `getEnsName → ${subject}`);
          update(primary, fromView(v.primaryName));
        }
      };
      show(view);
      while (view.status !== 'done' && view.status !== 'failed') {
        await sleep(pollMs);
        try {
          view = await follow(view.id);
          show(view);
        } catch {
          // A missed poll; the next one catches up.
        }
      }
      if (view.status === 'failed') throw new TxFailed(tx);
      return view;
    },

    /** Follows a transaction the site sent itself: `sign` signs and sends it and returns the hash. Done once the head
     *  is past the receipt's block, as the relayer counts it. */
    async direct(client: Pick<PublicClient, 'waitForTransactionReceipt' | 'getBlockNumber'>, kind: string, subject: string, sign: () => Promise<Hash>): Promise<{ hash: Hash; block: bigint }> {
      const tx = start(kind, subject);
      try {
        const hash = await sign();
        update(tx, { status: 'sent', hash });
        const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: pollMs });
        update(tx, { status: 'in-block', block: Number(receipt.blockNumber) });
        if (receipt.status !== 'success') {
          update(tx, { status: 'failed', error: 'reverted' });
          throw new TxFailed(tx);
        }
        while ((await client.getBlockNumber({ cacheTime: 0 })) <= receipt.blockNumber) await sleep(pollMs);
        update(tx, { status: 'done' });
        return { hash, block: receipt.blockNumber };
      } catch (err) {
        if (err instanceof TxFailed) throw err;
        update(tx, { status: 'failed', error: errorName(err) });
        throw new TxFailed(tx);
      }
    },
  };
}
