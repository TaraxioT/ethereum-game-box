// The Worker's own checks on what the agent proposes. Any agent can be tricked, so nothing it says is believed: a split
// must pay each of the pot's players a whole number, adding up to exactly the pot, or it fails the run.

import type { AgentVerdict } from '@egb/shared/store';

import { isRecord } from './json.ts';
import { LIMITS } from './limits.ts';

/** The pot a verdict is about. */
export interface PotShape {
  readonly seats: number;
  /** Each player's stake, a decimal string. */
  readonly amount: string;
}

export type ReadVerdict = { readonly verdict: AgentVerdict } | { readonly problem: string };

const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/;

function payoutsProblem(payouts: unknown, pot: PotShape): string | null {
  if (!Array.isArray(payouts)) return 'a split has no payouts';
  if (payouts.length !== pot.seats) return `a split has ${payouts.length} payouts for ${pot.seats} players`;
  if (!payouts.every((payout) => typeof payout === 'string' && DECIMAL.test(payout))) {
    return 'a split has a payout that is not a whole, non-negative number';
  }
  const sum = (payouts as string[]).reduce((total, payout) => total + BigInt(payout), 0n);
  return sum === BigInt(pot.amount) * BigInt(pot.seats) ? null : 'a split does not add up to exactly the pot';
}

/** `value` as a verdict, with only the fields a verdict has, or why it isn't one. */
export function readVerdict(value: unknown, pot: PotShape): ReadVerdict {
  if (!isRecord(value)) return { problem: 'the answer is not a verdict' };
  const { kind, payouts, why } = value;
  if (typeof why !== 'string' || why.length > LIMITS.whyChars) return { problem: 'a verdict needs a short reason' };
  if (kind === 'cannot_judge') return { verdict: { kind, why } };
  if (kind !== 'split') return { problem: 'a verdict of an unknown kind' };
  const problem = payoutsProblem(payouts, pot);
  return problem ? { problem } : { verdict: { kind, payouts: payouts as string[], why } };
}
