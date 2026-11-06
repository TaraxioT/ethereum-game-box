// `POST /cup/close`: closes a game's open championship once its `ends` has passed, sent as `Championships.close`.
// Anyone may ask (the demo Box's alarm does, so a championship closes even if nobody clicks): it pays the prize, gives
// the name to the winner for good and freezes its records.

import { championshipsAbi } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import { requireLabel } from '../box.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { CREATES_STORAGE_GAS, type Context, type Prepared, simulate } from '../request.ts';

export async function prepareCupClose(ctx: Context, input: unknown): Promise<Prepared> {
  const game = field.text(field.object(input), 'game');
  requireLabel(game, 'game');

  const cups = { address: ctx.addresses.cups, abi: championshipsAbi } as const;
  const id = await ctx.client.readContract({ ...cups, functionName: 'openCup', args: [game] });
  if (id === 0n) throw new Refusal(409, `${game} has no open championship`, 'NoOpenCup');
  const cup = await ctx.client.readContract({ ...cups, functionName: 'getCup', args: [id] });
  if (BigInt(ctx.now()) < BigInt(cup.ends)) {
    throw new Refusal(409, `${cup.label} runs until ${cup.ends}`, 'NotOver');
  }

  const call = { to: cups.address, data: encodeFunctionData({ ...cups, functionName: 'close', args: [game] }) };
  await simulate(ctx, call);
  return {
    kind: 'cup-close',
    ...call,
    value: 0n,
    // It unregisters the name and registers it again to the winner, which the estimate undercounts.
    gas: CREATES_STORAGE_GAS,
    locks: [`cup:${game}`],
  };
}
