// A claim's optional `primaryName`: the badge's ERC-191 consent to its new name as its primary name, sent to ENS's
// `DefaultReverseRegistrar` as `setNameForAddrWithSignature` once the claim is in a block. It is checked with the
// claim, before any gas.

import {
  PRIMARY_NAME_MAX_EXPIRY_SECONDS,
  defaultReverseRegistrarAbi,
  fullName,
  primaryNameDigest,
} from '@egb/shared/names';
import { type Address, encodeFunctionData } from 'viem';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Call, type Context, estimatedGas, simulate } from '../request.ts';
import { requireBadgeSignature } from '../verify.ts';

/** The consent must outlive the claim's block by this much (seconds). */
export const PRIMARY_NAME_MARGIN = 60;

const prefixed = (error: unknown) =>
  error instanceof Refusal ? new Refusal(error.status, `primaryName: ${error.message}`, error.revert) : error;

/** The checked reverse-registrar call for `primaryName`, or a refusal named `primaryName: ...`. */
export async function preparePrimaryName(ctx: Context, input: unknown, label: string, badge: Address): Promise<Call> {
  try {
    const consent = field.object(input, 'primaryName');
    const expiry = field.uint(consent, 'expiry');
    const signature = field.hex(consent, 'signature');
    const now = BigInt(ctx.now());
    if (expiry < now + BigInt(PRIMARY_NAME_MARGIN)) {
      throw new Refusal(400, `expiry must be at least ${PRIMARY_NAME_MARGIN}s away`);
    }
    if (expiry > now + BigInt(PRIMARY_NAME_MAX_EXPIRY_SECONDS)) {
      throw new Refusal(400, `expiry must be at most ${PRIMARY_NAME_MAX_EXPIRY_SECONDS}s away`, 'SignatureExpiryTooHigh');
    }
    const registrar = ctx.addresses.reverseRegistrar;
    const name = fullName(label);
    const digest = primaryNameDigest({ badge, name, expiry }, registrar);
    await requireBadgeSignature(ctx.client, badge, digest, signature);

    const call = {
      to: registrar,
      data: encodeFunctionData({
        abi: defaultReverseRegistrarAbi,
        functionName: 'setNameForAddrWithSignature',
        args: [badge, expiry, name, signature],
      }),
    };
    await simulate(ctx, call);
    return { ...call, value: 0n, gas: await estimatedGas(ctx, call), replay: { key: digest, until: Number(expiry) } };
  } catch (error) {
    throw prefixed(error);
  }
}
