// The parts round every page of a site: the Sepolia tag (chain, head block, relayer health) and the transaction strip.

import { formatEther } from 'viem';
import type { RelayerHealth, TxStatus } from '@egb/shared/names';
import type { HeadWatch, Tx, TxLog } from '@egb/shared/web';

import { append, h, txLink } from './dom.ts';

export interface ChainTagOptions {
  watch: Pick<HeadWatch, 'onHead'>;
  /** The relayer's `GET /health`. */
  health: () => Promise<RelayerHealth>;
  /** Called with each health answer (a site may remember the relayer's address). */
  onHealth?: (health: RelayerHealth) => void;
  everyMs?: number;
}

/** The Sepolia tag: proof the page is live. Asks the relayer's health now and every `everyMs`. */
export function mountChainTag(root: HTMLElement, { watch, health, onHealth, everyMs = 30_000 }: ChainTagOptions): () => void {
  const block = h('b', {}, '…');
  const relay = h('span.relay', {}, h('span.dot.wait'), 'relayer …');
  append(root, h('span', {}, h('span.dot'), 'Sepolia'), h('span', {}, 'block ', block), relay);
  const unwatch = watch.onHead((head) => {
    block.textContent = head.toLocaleString('en-US');
  });
  const ask = async () => {
    try {
      const view = await health();
      onHealth?.(view);
      const eth = Number(formatEther(BigInt(view.balance))).toFixed(3);
      relay.replaceChildren(h('span.dot'), 'relayer ', h('b', {}, 'ok'), h('span.bal', {}, ` · ${eth} ETH`));
      relay.title = `${view.address}: ${view.pending} pending, tip ${view.tipGwei} gwei`;
    } catch {
      relay.replaceChildren(h('span.dot.off'), 'relayer ', h('b', {}, 'down'));
    }
  };
  void ask();
  const timer = setInterval(ask, everyMs);
  return () => {
    unwatch();
    clearInterval(timer);
  };
}

const STEPS: readonly TxStatus[] = ['signed', 'sent', 'in-block', 'done'];

/** One write's progress: `signed › sent › in block n › done`, or the error where it stopped. */
export function txRow(tx: Tx): HTMLElement {
  const lastGood = tx.status === 'failed' ? (tx.block ? 2 : tx.hash ? 1 : 0) : STEPS.indexOf(tx.status);
  const steps = h('span.st');
  STEPS.forEach((step, i) => {
    if (i > 0) append(steps, h('i', {}, '›'));
    const text = step === 'in-block' ? (tx.block ? `in block ${tx.block.toLocaleString('en-US')}` : 'in block') : step;
    append(steps, h(i <= lastGood ? 'span.on' : 'span', {}, text));
  });
  if (tx.status === 'failed') append(steps, h('i', {}, '›'), h('span.err', {}, tx.error ?? 'failed'));
  return h(
    tx.status === 'failed' ? 'div.tx.failed' : 'div.tx',
    { 'data-status': tx.status },
    h('span.k', {}, tx.kind),
    h('span.s', {}, tx.subject),
    tx.hash ? txLink(tx.hash) : null,
    steps,
  );
}

/** Draws a transaction log into `root`, newest first. */
export function mountTxStrip(root: HTMLElement, log: Pick<TxLog, 'onTxs'>): () => void {
  return log.onTxs((txs) => root.replaceChildren(...txs.map(txRow)));
}
