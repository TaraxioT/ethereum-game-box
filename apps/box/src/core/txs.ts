// The Box's transactions on screen: each one from the moment the Box signs it, through the steps its chain port
// reports (sent, in a block, paid) or its failure, then on screen LINGER_MS more. Time is the core's clock.
import type { Seat } from "@egb/sdk";
import type { Clock, TxWatch } from "./ports.ts";
import type { Tx, TxKind } from "./types.ts";
import { createTimers } from "./timers.ts";

/** A paid or failed transaction stays on screen this long. */
export const LINGER_MS = 3_500;

export interface TxOrder {
  readonly kind: TxKind;
  readonly seat: Seat | null;
  readonly direction: "in" | "out";
  readonly amount: number;
}

export interface TxBook {
  /**
   * A transaction the Box just signed: its `signed` step is reported at once, and `watch` takes the port's steps.
   * `ended` runs once, when it is paid or failed.
   */
  submit(order: TxOrder, ended?: (tx: Tx) => void): { readonly tx: Tx; readonly watch: TxWatch };
  /** Transactions still on screen, oldest first. */
  list(): readonly Tx[];
  stop(): void;
}

export interface TxHooks {
  /** A transaction reached a new step (including `signed`). */
  step(tx: Tx): void;
  /** A paid or failed transaction left the screen. */
  drop(tx: Tx): void;
}

const over = (tx: Tx): boolean => tx.step === "paid" || tx.step === "failed";

export function createTxBook(hooks: TxHooks, clock: Clock): TxBook {
  const entries: { tx: Tx }[] = [];
  const timers = createTimers(clock);
  let nextId = 1;

  return {
    submit(order, ended) {
      const entry = {
        tx: { id: nextId++, ...order, step: "signed", block: null, hash: null, etherscan: null, error: null, stepAt: clock.now() } as Tx,
      };
      entries.push(entry);
      hooks.step(entry.tx);
      const watch: TxWatch = (update) => {
        const was = entry.tx;
        if (over(was)) return;
        entry.tx = {
          ...was,
          step: update.step,
          hash: update.hash ?? was.hash,
          etherscan: update.etherscan ?? was.etherscan,
          block: update.block ?? was.block,
          error: update.error,
          stepAt: clock.now(),
        };
        hooks.step(entry.tx);
        if (!over(entry.tx)) return;
        ended?.(entry.tx);
        timers.after(LINGER_MS, () => {
          entries.splice(entries.indexOf(entry), 1);
          hooks.drop(entry.tx);
        });
      };
      return { tx: entry.tx, watch };
    },
    list() {
      return entries.map((entry) => entry.tx);
    },
    stop() {
      timers.clear();
    },
  };
}
