// The parts round every view: the Sepolia tag (chain, head block, relayer health) and the transaction strip.
import { formatEther } from "viem";
import type { TxStatus } from "@egb/shared/names";

import { onHead } from "../chain.ts";
import { relayer } from "../relayer.ts";
import { type Tx, onTxs } from "../txs.ts";
import { h, txLink } from "./dom.ts";

export function mountChainTag(root: HTMLElement): void {
  const block = h("b", {}, "…");
  const relay = h("span.relay", {}, h("span.dot.wait"), "relayer …");
  root.append(h("span", {}, h("span.dot"), "Sepolia"), h("span", {}, "block ", block), relay);
  onHead((head) => {
    block.textContent = head.toLocaleString("en-US");
  });
  const health = async () => {
    try {
      const view = await relayer.health();
      relay.replaceChildren(
        h("span.dot"),
        "relayer ",
        h("b", {}, "ok"),
        h("span.bal", {}, ` · ${Number(formatEther(BigInt(view.balance))).toFixed(3)} ETH`),
      );
      relay.title = `${view.address}: ${view.pending} pending, tip ${view.tipGwei} gwei`;
    } catch {
      relay.replaceChildren(h("span.dot.off"), "relayer ", h("b", {}, "down"));
    }
  };
  void health();
  setInterval(health, 30_000);
}

const STEPS: readonly TxStatus[] = ["signed", "sent", "in-block", "done"];

/** One write's progress: `signed › sent › in block n › done`, or the error where it stopped. */
function txRow(tx: Tx): HTMLElement {
  const lastGood = tx.status === "failed" ? (tx.block ? 2 : tx.hash ? 1 : 0) : STEPS.indexOf(tx.status);
  const steps = h("span.st");
  STEPS.forEach((step, i) => {
    if (i > 0) steps.append(h("i", {}, "›"));
    const text = step === "in-block" ? (tx.block ? `in block ${tx.block.toLocaleString("en-US")}` : "in block") : step;
    steps.append(h(i <= lastGood ? "span.on" : "span", {}, text));
  });
  if (tx.status === "failed") steps.append(h("i", {}, "›"), h("span.err", {}, tx.error ?? "failed"));
  return h(
    tx.status === "failed" ? "div.tx.failed" : "div.tx",
    { "data-status": tx.status },
    h("span.k", {}, tx.kind),
    h("span.s", {}, tx.subject),
    tx.hash ? txLink(tx.hash) : null,
    steps,
  );
}

export function mountTxStrip(root: HTMLElement): void {
  onTxs((txs) => root.replaceChildren(...txs.map(txRow)));
}
