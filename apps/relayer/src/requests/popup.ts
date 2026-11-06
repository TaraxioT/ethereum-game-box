// `POST /box/popup`: opens `popup-<label>.gamebox.eth` with a 10-minute licence, sent as `DemoLicences.openPopup`. The
// pop-up is linked to its Box's record, so it serves the Box's records until it expires.

import { demoLicencesAbi, fullName, gameBoxNamesAbi, popupLabel, popupLabelProblem } from '@egb/shared/names';
import { encodeFunctionData } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { CREATES_STORAGE_GAS, type Context, type Prepared, simulate } from '../request.ts';

export async function preparePopup(ctx: Context, input: unknown): Promise<Prepared> {
  const label = field.text(field.object(input), 'label');
  const problem = popupLabelProblem(label);
  if (problem) throw new Refusal(400, `label: ${problem}`);
  const boxLabel = popupLabel(label);

  const popup = await ctx.client.readContract({
    address: ctx.addresses.names,
    abi: gameBoxNamesAbi,
    functionName: 'getPopup',
    args: [boxLabel],
  });
  if (BigInt(popup.expiry) > BigInt(ctx.now())) {
    throw new Refusal(409, `${fullName(boxLabel)} is live until ${popup.expiry}`, 'LabelAlreadyRegistered');
  }

  const call = {
    to: ctx.addresses.licences,
    data: encodeFunctionData({ abi: demoLicencesAbi, functionName: 'openPopup', args: [label] }),
  };
  await simulate(ctx, call);
  return { kind: 'popup', ...call, value: 0n, gas: CREATES_STORAGE_GAS, locks: [`label:${boxLabel}`] };
}
