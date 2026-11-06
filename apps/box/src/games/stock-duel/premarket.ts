// The pre-market, while both stakes go into the pot (the routes bring the game's screen up on the second signature):
// a slab in the tray says the market opens when the stakes clear, three status lamps follow the transaction (signed,
// sent, in a block) with its hash and the seconds so far, and a ticker tape crawls along the slab's foot with the
// chain's own numbers (the block, the gas, the pot). It never shows a stock's numbers: the hands are dealt after.
// When the stakes are in a block the opening bell rings, the slab flashes MARKET OPEN and goes.
import type { BoxState, Tx } from "../../core/types.ts";
import type { Rect } from "../../screen/shell/layout.ts";
import { calm, el, place, play, wait } from "../../screen/shell/dom.ts";
import { latestOpen, OPEN_STEPS, openLine, openStepIndex } from "../../screen/views/open-tx.ts";

export interface Premarket {
  readonly el: HTMLElement;
  /** Shows the slab and follows the open in `state`. */
  show(state: BoxState): void;
  /** The opening bell: MARKET OPEN, then the slab goes. Nothing if it was never shown. */
  open(): Promise<void>;
  dispose(): void;
}

/** How the tape's run of items reads: the same few facts, repeated to fill the slab twice over. */
function tapeText(state: BoxState): string {
  const { block, gasGwei } = state.chain;
  const items = [
    `SEPOLIA BLOCK ${block.toLocaleString("en-US")}`,
    `GAS ${gasGwei.toFixed(gasGwei < 10 ? 2 : 1)} GWEI`,
    `POT ${state.stake * 2} USDC`,
    `STAKE ${state.stake} USDC × 2`,
    "OPEN ON THE BELL",
  ];
  return `${items.join("  ▲  ")}  ▲  `;
}

export function createPremarket(at: Rect): Premarket {
  const root = el("div", "sd-pre");
  place(root, at);
  const head = el("b", "sd-pre-head", "PRE-MARKET");
  const line = el("span", "sd-pre-sub", "THE MARKET OPENS WHEN THE STAKES CLEAR");
  const lamps = el("div", "sd-pre-lamps");
  const lampEls = OPEN_STEPS.map(({ label }) => {
    const lamp = el("span", "sd-pre-lamp");
    lamp.append(el("i"), label);
    lamps.append(lamp);
    return lamp;
  });
  const hash = el("span", "sd-pre-hash");
  const tape = el("div", "sd-pre-tape");
  const run = el("div", "sd-pre-run");
  const runA = el("span");
  const runB = el("span");
  run.append(runA, runB);
  tape.append(run);
  root.append(head, line, lamps, hash, tape);

  let open: Tx | null = null;
  let since = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let up = false;
  let crawl: Animation | null = null;

  function drawHash(): void {
    if (open) hash.textContent = openLine(open, since);
  }

  return {
    el: root,

    show(state) {
      const tx = latestOpen(state);
      if (tx && tx.step !== "failed") {
        if (!open || open.id !== tx.id) since = Date.now();
        open = tx;
        const reached = openStepIndex(tx);
        lampEls.forEach((lamp, i) => {
          lamp.toggleAttribute("lit", i <= reached);
          lamp.toggleAttribute("next", i === reached + 1);
        });
        drawHash();
        ticker ??= setInterval(drawHash, 1000);
      }
      const text = tapeText(state);
      if (runA.textContent !== text) {
        runA.textContent = text;
        runB.textContent = text;
      }
      if (up) return;
      up = true;
      root.classList.add("on");
      void play(root, [{ opacity: 0, transform: "translateY(16px) scale(0.98)" }, { opacity: 1, transform: "none" }], {
        duration: 420,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
      // Two copies of the run side by side: sliding by one copy's width loops without a seam.
      if (!calm()) crawl = run.animate([{ transform: "translateX(0)" }, { transform: "translateX(-50%)" }], { duration: 16000, iterations: Infinity });
    },

    async open() {
      if (!up) return;
      up = false;
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
      for (const lamp of lampEls) lamp.toggleAttribute("lit", true);
      head.textContent = "MARKET OPEN";
      line.textContent = "THE STAKES ARE IN · DEALING";
      root.classList.add("opened");
      await play(root, [{ transform: "scale(1)" }, { transform: "scale(1.04)", offset: 0.25 }, { transform: "scale(1)" }], {
        duration: 420,
        easing: "ease-out",
      });
      await wait(500);
      await play(root, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px) scale(0.98)" }], {
        duration: 360,
        easing: "ease-in",
      });
      root.classList.remove("on", "opened");
      crawl?.cancel();
      crawl = null;
    },

    dispose() {
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
      crawl?.cancel();
    },
  };
}
