// The open: the one Box-signed transaction that moves both stakes into the pot before a team game's match begins.
// Stake and the team games' own waits (Quick Draw's paces, Stock Duel's pre-market) read it the same way.
import type { BoxState, Tx } from "../../core/types.ts";

/** The open's steps a screen shows while the match waits on it: the match begins once it is confirmed. */
export const OPEN_STEPS: readonly { readonly step: Tx["step"]; readonly label: string }[] = [
  { step: "signed", label: "SIGNED" },
  { step: "sent", label: "SENT" },
  { step: "in-block", label: "IN BLOCK" },
  { step: "paid", label: "CONFIRMED" },
];

/** The latest open on screen, or null. */
export function latestOpen(state: BoxState): Tx | null {
  return state.txs.findLast((tx) => tx.kind === "open") ?? null;
}

/** How far along `OPEN_STEPS` the open is: the index of its step, -1 for one that failed. */
export function openStepIndex(open: Tx): number {
  return OPEN_STEPS.findIndex(({ step }) => step === open.step);
}

export const shortHash = (hash: string): string => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

/** The open's hash (once sent) and the whole seconds it has taken since `since` (the screen's clock). */
export function openLine(open: Tx, since: number): string {
  const seconds = Math.floor((Date.now() - since) / 1000);
  return open.hash ? `${shortHash(open.hash)} · ${seconds} s` : `${seconds} s`;
}
