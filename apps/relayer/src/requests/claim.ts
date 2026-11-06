// `POST /names/claim`: a badge's signed claim of `<label>.gamebox.eth`, sent as `GameBoxNames.claimPlayer`.

import { claimNameDigest, fullName, gameBoxNamesAbi, labelProblem, permissionedRegistryAbi } from '@egb/shared/names';
import { encodeFunctionData, labelhash } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { CREATES_STORAGE_GAS, type Context, type Prepared, requireDeadline, simulate } from '../request.ts';
import { requireBadgeSignature } from '../verify.ts';

/** `IPermissionedRegistry.Status.AVAILABLE`. */
const AVAILABLE = 0;

export async function prepareClaim(ctx: Context, input: unknown): Promise<Prepared> {
  const body = field.object(input);
  const label = field.text(body, 'label');
  const problem = labelProblem(label);
  if (problem) throw new Refusal(400, `label: ${problem}`);
  const badge = field.address(body, 'badge');
  const deadline = field.uint(body, 'deadline');
  const signature = field.hex(body, 'signature');
  requireDeadline(ctx, deadline);

  const digest = claimNameDigest({ label, badge, deadline }, ctx.addresses.names);
  await requireBadgeSignature(ctx.client, badge, digest, signature);

  const names = { address: ctx.addresses.names, abi: gameBoxNamesAbi } as const;
  const [held, box, registry] = await Promise.all([
    ctx.client.readContract({ ...names, functionName: 'labelOf', args: [badge] }),
    ctx.client.readContract({ ...names, functionName: 'getBox', args: [label] }),
    ctx.client.readContract({ ...names, functionName: 'REGISTRY' }),
  ]);
  if (held) throw new Refusal(409, `the badge already holds ${fullName(held)}`, 'BadgeHasName');
  if (box.status !== 0) throw new Refusal(409, `${fullName(label)} is a Box name`, 'LabelHeldByBox');
  const status = await ctx.client.readContract({
    address: registry,
    abi: permissionedRegistryAbi,
    functionName: 'getStatus',
    args: [BigInt(labelhash(label))],
  });
  if (status !== AVAILABLE) throw new Refusal(409, `${fullName(label)} is taken`, 'LabelAlreadyRegistered');

  const data = encodeFunctionData({ ...names, functionName: 'claimPlayer', args: [label, badge, deadline, signature] });
  await simulate(ctx, { to: ctx.addresses.names, data });
  return {
    kind: 'claim',
    to: ctx.addresses.names,
    data,
    value: 0n,
    gas: CREATES_STORAGE_GAS,
    replay: { key: digest, until: Number(deadline) },
    locks: [`label:${label}`, `badge:${badge.toLowerCase()}`],
  };
}
