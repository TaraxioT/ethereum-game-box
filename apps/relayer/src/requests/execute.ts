// `POST /box/execute`: a call a Box's P-256 key signed for its `BoxAccount`, sent as `BoxAccount.execute`. Only the
// Box's own record writes (`lastSeen`, `game`) on its own name's resolver are paid for.

import { boxAccountAbi, executeDigest, fullName, gameBoxNamesAbi } from '@egb/shared/names';
import { encodeFunctionData, isAddressEqual } from 'viem';

import { deviceWrite } from '../allowlist.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, requireDeadline, simulate } from '../request.ts';
import { requireP256 } from '../verify.ts';

export async function prepareExecute(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const account = field.address(body, 'account');
  const target = field.address(body, 'target');
  const value = field.uint(body, 'value');
  const data = field.hex(body, 'data');
  const nonce = field.uint(body, 'nonce');
  const deadline = field.uint(body, 'deadline');
  const r = field.bytes32(body, 'r');
  const s = field.bytes32(body, 's');
  requireDeadline(ctx, deadline);
  if (value !== 0n) throw new Refusal(403, 'value must be 0: a Box write sends no ETH');

  const write = deviceWrite(data);
  const name = fullName(write.label);
  const box = await ctx.client.readContract({
    address: ctx.addresses.names,
    abi: gameBoxNamesAbi,
    functionName: 'getBox',
    args: [write.label],
  });
  if (box.status === 0) throw new Refusal(403, `${name} is not a Box`, 'UnknownBox');
  if (!isAddressEqual(box.account, account)) throw new Refusal(403, `account is not the BoxAccount of ${name}`);
  if (!isAddressEqual(box.resolver, target)) throw new Refusal(403, `target is not the resolver of ${name}`);
  if (BigInt(box.expiry) <= BigInt(ctx.now())) throw new Refusal(403, `${name}'s licence has expired`);

  const digest = executeDigest({ target, value, data, nonce, deadline }, account);
  requireP256(digest, r, s, box.qx, box.qy);

  const call = {
    to: account,
    data: encodeFunctionData({
      abi: boxAccountAbi,
      functionName: 'execute',
      args: [target, value, data, nonce, deadline, r, s],
    }),
  };
  await simulate(ctx, call);
  return {
    kind: 'execute',
    ...call,
    value: 0n,
    gas: await estimatedGas(ctx, call),
    replay: { key: digest, until: Number(deadline) },
    locks: [`nonce:${account.toLowerCase()}:${nonce}`],
  };
}
