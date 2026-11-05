// <egb-txbar>: the transaction-progress LCD strip. Its top line names the transaction ("FAUCET +100 EGB", "STAKE 2×10
// EGB", "PAYOUT 20 EGB", "REFUND 10 EGB") beside a hash cell (the shortened hash, or SIMULATED when there is none);
// under it the four steps, SIGNED → SENT → IN BLOCK n → PAID, each lit mint once reached, the rest dim ghosts.
//
// Size: it fills its box (designed at 380 × 52). `show(tx)` draws a transaction's current step (fading the strip in if
// it was hidden); `hide()` fades it out.
import type { Tx, TxStep } from "../link/types.ts";
import { pick, shadow, sheet } from "./part.ts";

const STEPS: readonly TxStep[] = ["signed", "sent", "in-block", "paid"];
const WORDS: Record<TxStep, string> = { signed: "SIGNED", sent: "SENT", "in-block": "IN BLOCK", paid: "PAID" };

/** The transaction's kind and amount, as the strip names it. An open with no seat carries both stakes. */
function kindOf(tx: Tx): string {
  switch (tx.kind) {
    case "faucet":
      return `FAUCET +${tx.amount} EGB`;
    case "open":
      return tx.seat === null ? `STAKE 2×${tx.amount / 2} EGB` : `STAKE ${tx.amount} EGB`;
    case "settle":
      return `PAYOUT ${tx.amount} EGB`;
    case "refund":
      return `REFUND ${tx.amount} EGB`;
  }
}

const shortHash = (hash: string): string => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

const styles = sheet(`
:host { display: block; position: relative; width: 380px; height: 52px; container-type: size; }
.bar { --p: calc(100cqh / 52); position: absolute; inset: 0; opacity: 0; transition: opacity 300ms var(--ease-out); }
.bar.on { opacity: 1; }
.lcd-frame { border-radius: calc(10 * var(--p)); }
.lcd-glass {
  --lcd-glass: var(--lcd-mint-bg);
  inset: calc(5 * var(--p)); border-radius: calc(6 * var(--p)); padding: 0 8px;
  display: flex; flex-direction: column; justify-content: center; gap: 1px;
  font: 700 14px / 1.05 var(--mono); color: var(--lcd-mint); white-space: nowrap;
}
.row { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.top { justify-content: space-between; }
.kind { text-shadow: 0 0 6px rgb(143 240 216 / 0.45); overflow: hidden; text-overflow: ellipsis; }
/* The hash cell: a darker window inset into the glass. */
.hash { padding: 0 5px; border-radius: 3px; background: rgb(0 0 0 / 0.35); box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.6), 0 1px 0 rgb(255 255 255 / 0.06); }
.hash.sim { color: var(--lcd-amber); }
/* A step: its ghost always there, its lit text over it fading up when the step is reached. */
.step { display: grid; }
.step > * { grid-area: 1 / 1; font-style: normal; }
.ghost { opacity: 0.16; }
.lit { opacity: 0; text-shadow: 0 0 6px rgb(143 240 216 / 0.5); transition: opacity 260ms var(--ease-out); }
.arrow { font-style: normal; opacity: 0.16; transition: opacity 260ms var(--ease-out); }
.reached .lit, .arrow.reached { opacity: 1; }
`);

export class EgbTxbar extends HTMLElement {
  readonly #bar: HTMLElement;
  readonly #kind: HTMLElement;
  readonly #hash: HTMLElement;
  readonly #steps: HTMLElement[];
  readonly #arrows: HTMLElement[];
  readonly #block: HTMLElement;

  constructor() {
    super();
    const steps = STEPS.map(
      (s, i) => `${i ? `<i class="arrow" aria-hidden="true">›</i>` : ""}<span class="step"><i class="ghost" aria-hidden="true">${WORDS[s]}</i><i class="lit">${WORDS[s]}${s === "in-block" ? `<span class="n"></span>` : ""}</i></span>`,
    ).join("");
    const root = shadow(
      this,
      styles,
      `<div class="bar" aria-live="polite"><div class="lcd-frame"></div><div class="lcd-glass">
        <div class="row top"><span class="kind"></span><span class="hash"></span></div>
        <div class="row">${steps}</div>
      </div></div>`,
    );
    this.#bar = pick(root, ".bar");
    this.#kind = pick(root, ".kind");
    this.#hash = pick(root, ".hash");
    this.#steps = [...root.querySelectorAll<HTMLElement>(".step")];
    this.#arrows = [...root.querySelectorAll<HTMLElement>(".arrow")];
    this.#block = pick(root, ".n");
  }

  show(tx: Tx): void {
    const at = STEPS.indexOf(tx.step);
    this.#kind.textContent = kindOf(tx);
    this.#hash.textContent = tx.hash ? shortHash(tx.hash) : "SIMULATED";
    this.#hash.classList.toggle("sim", !tx.hash);
    this.#block.textContent = tx.block === null ? "" : ` ${tx.block.toLocaleString("en-US")}`;
    this.#steps.forEach((s, i) => s.classList.toggle("reached", i <= at));
    // The arrow before a step lights with it.
    this.#arrows.forEach((a, i) => a.classList.toggle("reached", i + 1 <= at));
    this.#bar.classList.add("on");
  }

  hide(): void {
    this.#bar.classList.remove("on");
  }
}
