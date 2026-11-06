// The simulated EGB ledger: a balance per badge address, a faucet for badges that can't cover a stake, and the match
// escrow. Pure: every operation returns a new ledger. Where it is kept is the host's (LedgerStore).
import type { Seat } from "@egb/sdk";
import type { LedgerData, LedgerStore } from "./ports.ts";

/** The faucet tops a badge that can't cover the stake back up to this. */
export const FAUCET_EGB = 100;

/**
 * Whole EGB per address (an address is here once the faucet has paid it), and the open match's escrow: each stake
 * under the badge that put it in, so a stake can always go back to its owner, even after a restart.
 */
export type Ledger = LedgerData;

export const EMPTY_LEDGER: Ledger = { balances: {}, escrow: {} };

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

/** EGB held in escrow, all stakes together. */
export function escrowTotal(ledger: Ledger): number {
  return Object.values(ledger.escrow).reduce((sum, amount) => sum + amount, 0);
}

/** The faucet pays exactly what its transaction announced. */
export function faucet(ledger: Ledger, address: string, amount: number): Ledger {
  return credit(ledger, address, amount);
}

function credit(ledger: Ledger, address: string, amount: number): Ledger {
  return { ...ledger, balances: { ...ledger.balances, [address]: balanceOf(ledger, address) + amount } };
}

/** Takes `stake` out of the escrow `from` holds. */
function takeStake(ledger: Ledger, from: string, stake: number): Ledger {
  const held = ledger.escrow[from] ?? 0;
  if (stake > held) throw new RangeError(`escrow holds ${held} EGB of ${from}'s, not ${stake}`);
  const escrow = { ...ledger.escrow };
  if (held === stake) delete escrow[from];
  else escrow[from] = held - stake;
  return { ...ledger, escrow };
}

/** Opens a match: both seats' stakes move into escrow, each under its own badge. */
export function lock(ledger: Ledger, addresses: readonly [string, string], stake: number): Ledger {
  let next = ledger;
  for (const address of addresses) {
    const balance = balanceOf(next, address);
    if (balance < stake) throw new RangeError(`${address} holds ${balance} EGB, not ${stake}`);
    next = {
      balances: { ...next.balances, [address]: balance - stake },
      escrow: { ...next.escrow, [address]: (next.escrow[address] ?? 0) + stake },
    };
  }
  return next;
}

/** Settles a match: the winner takes both stakes; a draw (winner null) returns each its own. */
export function settle(ledger: Ledger, addresses: readonly [string, string], stake: number, winner: Seat | null): Ledger {
  const [a, b] = addresses;
  const taken = takeStake(takeStake(ledger, a, stake), b, stake);
  if (winner === null) return credit(credit(taken, a, stake), b, stake);
  return credit(taken, addresses[winner], stake * 2);
}

/** One seat takes its stake back from an unsettled match. */
export function refund(ledger: Ledger, address: string, stake: number): Ledger {
  return credit(takeStake(ledger, address, stake), address, stake);
}

/** Every stake still in escrow goes back to the badge that put it in. */
export function returnAll(ledger: Ledger): Ledger {
  let next: Ledger = { ...ledger, escrow: {} };
  for (const [address, amount] of Object.entries(ledger.escrow)) next = credit(next, address, amount);
  return next;
}
