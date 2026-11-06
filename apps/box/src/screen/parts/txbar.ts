// <egb-txbar>: the transaction strip. A panel-style frame whose top line names the transaction ("TOP UP +100 USDC",
// "NAME", "STAKE 2×10 USDC", or 3× or 4×, "PAYOUT 20 USDC", "RESULT", "REFUND 20 USDC") beside a hash cell (the shortened hash,
// linked to its Etherscan page; empty until the relayer has sent it, and always in the demo, which has none); under it
// the four steps, SIGNED › SENT › IN BLOCK n › PAID, each lit in the system's light once reached (the one just reached
// flickers once), the rest dim. A failed transaction lights the strip in the alert colour and says FAILED for PAID.
//
// Size: it fills its box (designed at 380 × 52). `show(tx)` draws a transaction's current step, rezzing the strip in
// if it was hidden; `hide()` derezzes it.
import type { Tx, TxStep } from "../../core/types.ts";
import { chamferClip, fitFrame } from "./frame.ts";
import { pick, shadow, sheet } from "./part.ts";
import { derez, flicker, rez } from "../shell/rez.ts";

const STEPS: readonly Exclude<TxStep, "failed">[] = ["signed", "sent", "in-block", "paid"];
const WORDS: Record<Exclude<TxStep, "failed">, string> = { signed: "SIGNED", sent: "SENT", "in-block": "IN BLOCK", paid: "PAID" };
const CHAMFER = 12;

/** The transaction's kind and amount, as the strip names it. An open with no seat carries every player's stake. */
function kindOf(tx: Tx, players: number): string {
  switch (tx.kind) {
    case "topup":
      return `TOP UP +${tx.amount} USDC`;
    case "claim":
      return "NAME";
    case "open":
      return tx.seat === null ? `STAKE ${players}×${tx.amount / players} USDC` : `STAKE ${tx.amount} USDC`;
    case "settle":
      return tx.amount > 0 ? `PAYOUT ${tx.amount} USDC` : "RESULT";
    case "refund":
      return `REFUND ${tx.amount} USDC`;
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
.hash a { color: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.bar.failed { --frame-tone: var(--alert); }
.bar.failed .frame-line { opacity: 0.8; }
.bar.failed .kind, .bar.failed .reached { color: var(--alert); }
.step, .arrow { font: 600 14px / 1 var(--hud-body); letter-spacing: 0.02em; font-style: normal; color: var(--sys); opacity: 0.22; }
/* A step flickers as it is reached; it keeps its layer so the strip isn't rastered again round it each time. */
.step { will-change: opacity; }
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

  /** `players`: how many a match has, which an open with no seat is split between. */
  show(tx: Tx, players: number): void {
    const failed = tx.step === "failed";
    // A failure lights what it reached; its last step reads FAILED.
    const at = failed ? STEPS.length - 1 : STEPS.indexOf(tx.step);
    const hidden = this.#out;
    this.#out = false;
    this.#kind.textContent = kindOf(tx, players);
    this.#bar.classList.toggle("failed", failed);
    const paidStep = this.#steps[STEPS.length - 1];
    if (paidStep) paidStep.textContent = failed ? "FAILED" : WORDS.paid;
    if (tx.hash && tx.etherscan) {
      const link = document.createElement("a");
      link.href = tx.etherscan;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = shortHash(tx.hash);
      this.#hash.replaceChildren(link);
    } else {
      this.#hash.textContent = tx.hash ? shortHash(tx.hash) : "";
    }
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
