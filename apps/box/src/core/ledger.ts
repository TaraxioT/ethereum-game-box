// The simulated EGB ledger: a balance per badge address, a faucet for badges that can't cover a stake, and the match
// escrow. Pure: every operation returns a new ledger. Where it is kept is the host's (LedgerStore).
import type { Seat } from "@egb/sdk";
import type { LedgerData, LedgerStore } from "./ports.ts";

/** The faucet tops a badge that can't cover the stake back up to this. */
export const FAUCET_EGB = 100;

/** Whole EGB per address (an address is here once the faucet has paid it), and the EGB held for the open match. */
export type Ledger = LedgerData;

export const EMPTY_LEDGER: Ledger = { balances: {}, escrow: 0 };

/** A ledger kept in memory only: the demo's, and tests'. */
export function memoryLedgerStore(initial: Ledger = EMPTY_LEDGER): LedgerStore & { current(): Ledger } {
  let kept = initial;
  return {
    load: () => kept,
    save(ledger) {
      kept = ledger;
    },
    current: () => kept,
  };
}

export function balanceOf(ledger: Ledger, address: string): number {
  return ledger.balances[address] ?? 0;
}

/** The faucet pays exactly what its transaction announced. */
export function faucet(ledger: Ledger, address: string, amount: number): Ledger {
  return credit(ledger, address, amount);
}

function credit(ledger: Ledger, address: string, amount: number): Ledger {
  return { ...ledger, balances: { ...ledger.balances, [address]: balanceOf(ledger, address) + amount } };
}

function release(ledger: Ledger, address: string, amount: number): Ledger {
  if (amount > ledger.escrow) throw new RangeError(`escrow holds ${ledger.escrow} EGB, not ${amount}`);
  return { ...credit(ledger, address, amount), escrow: ledger.escrow - amount };
}

/** Opens a match: both seats' stakes move into escrow. */
export function lock(ledger: Ledger, addresses: readonly [string, string], stake: number): Ledger {
  let next = ledger;
  for (const address of addresses) {
    const balance = balanceOf(next, address);
    if (balance < stake) throw new RangeError(`${address} holds ${balance} EGB, not ${stake}`);
    next = { ...next, balances: { ...next.balances, [address]: balance - stake } };
  }
  return { ...next, escrow: next.escrow + stake * 2 };
}

/** Settles a match: the winner takes both stakes; a draw (winner null) returns each its own. */
export function settle(ledger: Ledger, addresses: readonly [string, string], stake: number, winner: Seat | null): Ledger {
  if (winner === null) return release(release(ledger, addresses[0], stake), addresses[1], stake);
  return release(ledger, addresses[winner], stake * 2);
}

/** One seat takes its stake back from an unsettled match. */
export function refund(ledger: Ledger, address: string, stake: number): Ledger {
  return release(ledger, address, stake);
}
