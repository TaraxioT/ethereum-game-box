// The check every Box-signed request makes (`Result`, `Stake`, `Seat`), as the contracts' `BoxCheck` makes it: the Box
// is registered in `GameBoxNames`, its licence (its name) is unexpired, its status is `Active`, and the P-256 signature
// over the message's digest is its key's, with a low `s`.

import { gameBoxNamesAbi, labelProblem } from '@egb/shared/names';
import type { Hex } from 'viem';

import { Refusal } from './refusal.ts';
import type { Context } from './request.ts';
import { requireP256 } from './verify.ts';

/** `GameBoxNames.BoxStatus`. */
const NONE = 0;
const ACTIVE = 1;

/** The lock a round's pot requests (open, refund) and its result share: one of them is pending at a time. */
export const potLock = (box: string, round: bigint) => `pot:${box}:${round}`;

/** Throws a 400 naming `<field>` unless `value` follows the label rule. */
export function requireLabel(value: string, field: string): void {
  const problem = labelProblem(value);
  if (problem) throw new Refusal(400, `${field}: ${problem}`);
}

/** Throws a 403 unless `box` is a live, `Active` Box, then a 401 unless `(r, s)` is its key's signature of `digest`. */
export async function requireBoxSigned(ctx: Context, box: string, digest: Hex, r: Hex, s: Hex): Promise<void> {
  const entry = await ctx.client.readContract({
    address: ctx.addresses.names,
    abi: gameBoxNamesAbi,
    functionName: 'getBox',
    args: [box],
  });
  if (entry.status === NONE) throw new Refusal(403, `${box} is not a Box`, 'UnknownBox');
  if (BigInt(entry.expiry) <= BigInt(ctx.now())) throw new Refusal(403, `${box}'s licence has expired`, 'BoxExpired');
  if (entry.status !== ACTIVE) throw new Refusal(403, `${box} is not active`, 'BoxNotActive');
  requireP256(digest, r, s, entry.qx, entry.qy);
}
