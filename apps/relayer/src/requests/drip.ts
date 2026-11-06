// `POST /names/drip`: a little ETH to a badge that holds a player name, so it can send the calls that must come from
// the badge itself (its own `revokeRoles`, its own record writes). Once per badge.

import { gameBoxNamesAbi } from '@egb/shared/names';
import { formatEther } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas } from '../request.ts';

export async function prepareDrip(ctx: Context, input: unknown): Promise<Prepared> {
  const badge = field.address(field.object(input), 'badge');
  const [name, balance, code] = await Promise.all([
    ctx.client.readContract({ address: ctx.addresses.names, abi: gameBoxNamesAbi, functionName: 'nameOf', args: [badge] }),
    ctx.client.getBalance({ address: badge }),
    ctx.client.getCode({ address: badge }),
  ]);
  if (!name) throw new Refusal(403, 'the badge holds no player name', 'NotAPlayer');
  if (code && code !== '0x') throw new Refusal(403, 'a contract account needs no ETH: it acts through /account/execute');
  if (balance >= ctx.dripWei) throw new Refusal(409, `the badge already holds ${formatEther(balance)} ETH`);

  const call = { to: badge, data: '0x' as const, value: ctx.dripWei };
  return {
    kind: 'drip',
    ...call,
    gas: await estimatedGas(ctx, call),
    replay: { key: `drip:${badge.toLowerCase()}`, until: 0 },
    locks: [`badge:${badge.toLowerCase()}`],
  };
}
