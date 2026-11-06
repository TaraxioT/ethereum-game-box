// `POST /usdc/topup`: the lobby's top-up. It mints `TOPUP` test USDC (`FakeUSDC.mint`, which the relayer's wallet may
// call as its minter) to a player, whatever it already holds; `limits.ts` keeps it to one per player per 10 minutes.
// The player is an address, or an ENS name resolved with stock viem through the Universal Resolver. `POST /store/topup`
// is the same on Store USDC (`store-pot.ts`).

import { fakeUsdcAbi, usdc } from '@egb/shared/names';
import { type Address, encodeFunctionData, getAddress, isAddress } from 'viem';
import { normalize } from 'viem/ens';

import * as field from '../parse.ts';
import { Refusal } from '../refusal.ts';
import { type Context, type Prepared, estimatedGas, simulate } from '../request.ts';
import { isRevert } from '../revert.ts';

/** What one top-up mints. */
export const TOPUP = usdc(100);

/** The address `player` names: itself, or what its ENS name resolves to. Throws a 400 or a 404. */
async function playerAddress(ctx: Context, player: string): Promise<Address> {
  if (isAddress(player, { strict: false })) return getAddress(player);
  let name: string;
  try {
    name = normalize(player);
  } catch {
    throw new Refusal(400, 'player: expected an address or an ENS name');
  }
  if (!name.includes('.')) throw new Refusal(400, 'player: expected an address or an ENS name');
  // A name with no resolver anywhere on its path makes the Universal Resolver revert: it doesn't resolve.
  const address = await ctx.client.getEnsAddress({ name }).catch((error: unknown) => {
    if (isRevert(error)) return null;
    throw error;
  });
  if (!address) throw new Refusal(404, `${name} does not resolve to an address`);
  return address;
}

/** The mint of `TOPUP` of the `FakeUSDC` at `address` to the player in `input`. */
export async function prepareMint(ctx: Context, input: unknown, address: Address, kind: 'topup' | 'store-topup'): Promise<Prepared> {
  const player = await playerAddress(ctx, field.text(field.object(input), 'player'));
  const token = { address, abi: fakeUsdcAbi } as const;

  const call = { to: token.address, data: encodeFunctionData({ ...token, functionName: 'mint', args: [player, TOPUP] }) };
  await simulate(ctx, call);
  return {
    kind,
    account: player,
    ...call,
    value: 0n,
    gas: await estimatedGas(ctx, call),
    locks: [`${kind}:${player.toLowerCase()}`],
  };
}

export function prepareTopup(ctx: Context, input: unknown): Promise<Prepared> {
  return prepareMint(ctx, input, ctx.addresses.usdc, 'topup');
}
