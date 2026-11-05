// The simulated EGB ledger: a balance per badge address, a faucet for badges that can't cover a stake, and the match escrow. Pure: every
// operation returns a new ledger.
import type { Seat } from "../../../games/seat.ts";

export const FAUCET_EGB = 100;
/** Below this the faucet tops a badge back up: the smallest stake any game offers. */
export const FAUCET_BELOW = 5;

export interface Ledger {
  /** Whole EGB per address. An address is here once the faucet has paid it. */
  readonly balances: Readonly<Record<string, number>>;
  /** EGB held for the open match. */
  readonly escrow: number;
}

export const EMPTY_LEDGER: Ledger = { balances: {}, escrow: 0 };

export function balanceOf(ledger: Ledger, address: string): number {
  return ledger.balances[address] ?? 0;
}

/** The address holds enough to stake, so the faucet has nothing to give it. */
export function funded(ledger: Ledger, address: string): boolean {
  return balanceOf(ledger, address) >= FAUCET_BELOW;
}

/** Tops a new or nearly empty address up to FAUCET_EGB; a funded one gets nothing. */
export function faucet(ledger: Ledger, address: string): Ledger {
  if (funded(ledger, address)) return ledger;
  return { ...ledger, balances: { ...ledger.balances, [address]: FAUCET_EGB } };
}

/** What the faucet would pay this address. */
export function faucetAmount(ledger: Ledger, address: string): number {
  return funded(ledger, address) ? 0 : FAUCET_EGB - balanceOf(ledger, address);
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
