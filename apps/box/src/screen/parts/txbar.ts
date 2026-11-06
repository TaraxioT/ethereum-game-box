// <egb-txbar>: the transaction strip. A panel-style frame whose top line names the transaction ("FAUCET +100 EGB",
// "STAKE 2×10 EGB", "PAYOUT 20 EGB", "REFUND 10 EGB") beside a hash cell (the shortened hash, or SIMULATED when there
// is none); under it the four steps, SIGNED › SENT › IN BLOCK n › PAID, each lit in the system's light once reached
// (the one just reached flickers once), the rest dim.
//
// Size: it fills its box (designed at 380 × 52). `show(tx)` draws a transaction's current step, rezzing the strip in
// if it was hidden; `hide()` derezzes it.
import type { Tx, TxStep } from "../link/types.ts";
import { chamferClip, fitFrame } from "./frame.ts";
import { pick, shadow, sheet } from "./part.ts";
import { derez, flicker, rez } from "../shell/rez.ts";

const STEPS: readonly TxStep[] = ["signed", "sent", "in-block", "paid"];
const WORDS: Record<TxStep, string> = { signed: "SIGNED", sent: "SENT", "in-block": "IN BLOCK", paid: "PAID" };
const CHAMFER = 12;

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
:host { display: block; position: relative; width: 380px; height: 52px; }
.bar {
  position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 0 12px;
  visibility: hidden; white-space: nowrap;
}
.bar.on { visibility: visible; }
.frame-fill { position: absolute; inset: 0; background: var(--glass); clip-path: ${chamferClip(CHAMFER)}; }
.frame-line { opacity: 0.45; }
.frame-bloom { opacity: 0; }
.row { position: relative; display: flex; align-items: baseline; gap: 5px; overflow: hidden; }
.top { justify-content: space-between; }
.kind { font: 600 16px / 1 var(--hud-body); letter-spacing: 0.08em; color: var(--fg); overflow: hidden; text-overflow: ellipsis; }
.hash { font: 500 14px / 1 var(--mono); color: var(--fg-3); }
.step, .arrow { font: 600 14px / 1 var(--hud-body); letter-spacing: 0.02em; font-style: normal; color: var(--sys); opacity: 0.22; }
.reached { opacity: 1; text-shadow: var(--glow-text); }
.n { font-family: var(--mono); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
`);

export class EgbTxbar extends HTMLElement {
  readonly #bar: HTMLElement;
  readonly #kind: HTMLElement;
  readonly #hash: HTMLElement;
  readonly #steps: HTMLElement[];
  readonly #arrows: HTMLElement[];
  readonly #block: HTMLElement;
  #at = -1;
  /** A derez is under way (or done): the next show rezzes the strip back in. */
  #out = true;

  constructor() {
    super();
    const steps = STEPS.map(
      (s, i) => `${i ? `<i class="arrow" aria-hidden="true">›</i>` : ""}<span class="step">${WORDS[s]}${s === "in-block" ? `<span class="n"></span>` : ""}</span>`,
    ).join("");
    const root = shadow(
      this,
      styles,
      `<div class="bar" aria-live="polite"><i class="frame-fill"></i>
        <div class="row top"><span class="kind"></span><span class="hash"></span></div>
        <div class="row">${steps}</div>
      </div>`,
    );
    this.#bar = pick(root, ".bar");
    this.#kind = pick(root, ".kind");
    this.#hash = pick(root, ".hash");
    this.#steps = [...root.querySelectorAll<HTMLElement>(".step")];
    this.#arrows = [...root.querySelectorAll<HTMLElement>(".arrow")];
    this.#block = pick(root, ".n");
    fitFrame(this.#bar, { chamfer: CHAMFER, ticks: true });
  }

  show(tx: Tx): void {
    const at = STEPS.indexOf(tx.step);
    const hidden = this.#out;
    this.#out = false;
    this.#kind.textContent = kindOf(tx);
    this.#hash.textContent = tx.hash ? shortHash(tx.hash) : "SIMULATED";
    this.#block.textContent = tx.block === null ? "" : ` ${tx.block.toLocaleString("en-US")}`;
    this.#steps.forEach((s, i) => s.classList.toggle("reached", i <= at));
    // The arrow before a step lights with it.
    this.#arrows.forEach((a, i) => a.classList.toggle("reached", i + 1 <= at));
    this.#bar.classList.add("on");
    if (hidden) void rez(this.#bar);
    else if (at > this.#at && this.#steps[at]) flicker(this.#steps[at]);
    this.#at = at;
  }

  hide(): void {
    if (this.#out) return;
    this.#out = true;
    this.#at = -1;
    void derez(this.#bar).then(() => {
      if (this.#out) this.#bar.classList.remove("on");
    });
  }
}
