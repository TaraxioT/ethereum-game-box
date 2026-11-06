// Simulated transactions and their timing: signed at once, sent SEND_MS later, in the first block sealed after it
// was sent, paid PAY_MS after that block, then on screen for LINGER_MS more. Blocks come from whoever runs the
// chain clock, through `seal`.
import type { Tx, TxKind } from "../types.ts";
import type { Seat } from "@egb/sdk";

export const SEND_MS = 400;
export const PAY_MS = 900;
export const LINGER_MS = 3_500;

export interface TxOrder {
  readonly kind: TxKind;
  readonly seat: Seat | null;
  readonly direction: "in" | "out";
  readonly amount: number;
}

export interface TxBook {
  /** Signs a transaction; `land` runs when it reaches a block, just before its `in-block` step is reported. */
  submit(order: TxOrder, land: () => void): Tx;
  /** A block was sealed at `at`: every transaction sent before then goes into it. */
  seal(block: number, at: number): void;
  /** Transactions still on screen, oldest first. */
  list(): readonly Tx[];
  stop(): void;
}

export interface TxHooks {
  /** A transaction reached a new step (including `signed`). */
  step(tx: Tx): void;
  /** A paid transaction left the screen. */
  drop(tx: Tx): void;
}

interface Entry {
  tx: Tx;
  readonly land: () => void;
  sentAt: number | null;
}

export function createTxBook(hooks: TxHooks): TxBook {
  const entries: Entry[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 1;

  function later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  function advance(entry: Entry, changes: Partial<Tx>): void {
    entry.tx = { ...entry.tx, ...changes, stepAt: Date.now() };
    hooks.step(entry.tx);
  }

  function pay(entry: Entry): void {
    advance(entry, { step: "paid" });
    later(LINGER_MS, () => {
      entries.splice(entries.indexOf(entry), 1);
      hooks.drop(entry.tx);
    });
  }

  return {
    submit(order, land) {
      const tx: Tx = { id: nextId++, ...order, step: "signed", block: null, hash: null, stepAt: Date.now() };
      const entry: Entry = { tx, land, sentAt: null };
      entries.push(entry);
      hooks.step(tx);
      later(SEND_MS, () => {
        entry.sentAt = Date.now();
        advance(entry, { step: "sent" });
      });
      return tx;
    },
    seal(block, at) {
      for (const entry of entries) {
        if (entry.tx.step !== "sent" || entry.sentAt === null || entry.sentAt >= at) continue;
        entry.land();
        advance(entry, { step: "in-block", block });
        later(PAY_MS, () => pay(entry));
      }
    },
    list() {
      return entries.map((entry) => entry.tx);
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
