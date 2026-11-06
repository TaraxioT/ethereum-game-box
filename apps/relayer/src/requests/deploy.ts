// `POST /account/deploy`: deploys the `P256Account` of a public key (a new passkey's, or a Worker key's) through
// `P256AccountFactory.deploy`. The account's address is `accountOf(qx, qy)` before and after.

import { p256AccountFactoryAbi } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { CREATES_STORAGE_GAS, type Context, type Prepared, simulate } from '../request.ts';
import { isP256Point } from '../verify.ts';

export async function prepareDeploy(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const qx = field.bytes32(body, 'qx');
  const qy = field.bytes32(body, 'qy');
  if (!isP256Point(qx, qy)) throw new Refusal(400, 'qx, qy: not a point on P-256');

  const factory = { address: ctx.addresses.factory, abi: p256AccountFactoryAbi } as const;
  const account = await ctx.client.readContract({ ...factory, functionName: 'accountOf', args: [qx, qy] });
  const code = await ctx.client.getCode({ address: account });
  if (code && code !== '0x') throw new Refusal(409, `the account ${account} is already deployed`);

  const call = { to: factory.address, data: encodeFunctionData({ ...factory, functionName: 'deploy', args: [qx, qy] }) };
  await simulate(ctx, call);
  // A new account is new code (about 1,542 gas a byte), which the estimate undercounts.
  return { kind: 'deploy', ...call, value: 0n, gas: CREATES_STORAGE_GAS, locks: [`account:${account.toLowerCase()}`] };
}
