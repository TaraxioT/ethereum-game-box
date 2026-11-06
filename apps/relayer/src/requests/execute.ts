// `POST /account/execute`: a call (or a batch) that a `P256Account`'s key signed, raw or with a passkey, sent as
// `P256Account.execute` (or `executeBatch`). The account must be one `P256AccountFactory` made, and every call must be
// on the allowlist (`allowlist.ts`).

import {
  type Call,
  executeBatchDigest,
  executeDigest,
  fullName,
  p256AccountAbi,
  permissionedRegistryAbi,
} from '@egb/shared/names';
import { type Address, type Hex, encodeFunctionData, isAddressEqual } from 'viem';

import { factoryAccountKey } from '../account.ts';
import { allowedCall } from '../allowlist.ts';
import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, callGas, requireDeadline, simulate } from '../request.ts';
import { accountSignatureProblem } from '../verify.ts';

/** The most calls one batch may hold. */
export const MAX_BATCH = 16;

function parseCall(input: unknown, at: string): Call {
  const body = field.object(input, at);
  return {
    target: field.address(body, 'target', at),
    value: field.uint(body, 'value', at),
    data: field.hex(body, 'data', at),
  };
}

/** `{ call }` as one call, or `{ calls }` as a batch: exactly one of them. */
function parseCalls(body: field.Body): { calls: Call[]; batch: boolean } {
  if ((body.call === undefined) === (body.calls === undefined)) throw new Refusal(400, 'body: expected call or calls');
  if (body.call !== undefined) return { calls: [parseCall(body.call, 'call')], batch: false };
  if (!Array.isArray(body.calls) || body.calls.length === 0 || body.calls.length > MAX_BATCH) {
    throw new Refusal(400, `calls: expected 1 to ${MAX_BATCH} calls`);
  }
  return { calls: body.calls.map((call, i) => parseCall(call, `calls[${i}]`)), batch: true };
}

/** Throws a 403 unless `target` is the resolver `<label>.gamebox.eth` has now. */
async function requireNameResolver(ctx: Context, label: string, target: Address): Promise<void> {
  const resolver = await ctx.client.readContract({
    address: ctx.addresses.registry,
    abi: permissionedRegistryAbi,
    functionName: 'getResolver',
    args: [label],
  });
  if (!isAddressEqual(resolver, target)) throw new Refusal(403, `the target is not the resolver of ${fullName(label)}`);
}

export async function prepareExecute(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const account = field.address(body, 'account');
  const nonce = field.uint(body, 'nonce');
  const deadline = field.uint(body, 'deadline');
  const signature = field.hex(body, 'signature');
  const { calls, batch } = parseCalls(body);
  requireDeadline(ctx, deadline);

  const allowed = calls.map((call) => allowedCall(call, account, ctx.addresses.targets));
  const { qx, qy } = await factoryAccountKey(ctx, account);
  const digest = batch
    ? executeBatchDigest({ calls, nonce, deadline }, account)
    : executeDigest({ ...calls[0]!, nonce, deadline }, account);
  const problem = accountSignatureProblem(digest, signature, qx, qy);
  if (problem) throw new Refusal(401, problem);

  for (const [i, rule] of allowed.entries()) {
    if (rule.kind === 'resolver') await requireNameResolver(ctx, rule.label, calls[i]!.target);
  }
  const used = await ctx.client.readContract({ address: account, abi: p256AccountAbi, functionName: 'nonceUsed', args: [nonce] });
  if (used) throw new Refusal(409, `nonce ${nonce} of ${account} is already used`, 'NonceUsed');

  const data: Hex = batch
    ? encodeFunctionData({ abi: p256AccountAbi, functionName: 'executeBatch', args: [calls, nonce, deadline, signature] })
    : encodeFunctionData({
        abi: p256AccountAbi,
        functionName: 'execute',
        args: [calls[0]!.target, 0n, calls[0]!.data, nonce, deadline, signature],
      });
  const call = { to: account, data };
  await simulate(ctx, call);
  return {
    kind: 'execute',
    account,
    ...call,
    value: 0n,
    gas: await callGas(ctx, call),
    replay: { key: digest, until: Number(deadline) },
    locks: [`nonce:${account.toLowerCase()}:${nonce}`],
  };
}
