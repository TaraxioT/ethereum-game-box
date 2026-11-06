// Which `P256Account`s the relayer serves: those `P256AccountFactory` made. An account's address is
// `accountOf(qx, qy)` of the key it was made with. After a `rotateKey` it no longer matches its current key, so it is
// then found by the factory's `AccountDeployed` event instead.

import { type P256PublicKey, p256AccountAbi, p256AccountFactoryAbi } from '@egb/shared/names';
import { type Address, BaseError, ContractFunctionZeroDataError, isAddressEqual } from 'viem';

import { Refusal } from './refusal.ts';
import type { Context } from './request.ts';
import { isRevert } from './revert.ts';

/** Whether a read failed because the contract has no such function (as opposed to the RPC failing). */
const noSuchFunction = (error: unknown) =>
  isRevert(error) || (error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionZeroDataError) !== null);

/** The current key of `account`, or a 403 if it is not a `P256Account` the factory made. */
export async function factoryAccountKey(ctx: Context, account: Address): Promise<P256PublicKey> {
  const { factory, factoryBlock } = ctx.addresses;
  const notOurs = () => new Refusal(403, `${account} is not a P256Account made by P256AccountFactory`);
  const code = await ctx.client.getCode({ address: account });
  if (!code || code === '0x') {
    throw new Refusal(403, `${account} has no code: deploy the account first (POST /account/deploy)`);
  }
  const [qx, qy] = await ctx.client
    .readContract({ address: account, abi: p256AccountAbi, functionName: 'publicKey' })
    .catch((error: unknown) => {
      throw noSuchFunction(error) ? notOurs() : error;
    });
  const made = await ctx.client.readContract({
    address: factory,
    abi: p256AccountFactoryAbi,
    functionName: 'accountOf',
    args: [qx, qy],
  });
  if (isAddressEqual(made, account)) return { qx, qy };
  const deployed = await ctx.client.getContractEvents({
    address: factory,
    abi: p256AccountFactoryAbi,
    eventName: 'AccountDeployed',
    args: { account },
    fromBlock: factoryBlock,
    toBlock: 'latest',
  });
  if (deployed.length === 0) throw notOurs();
  return { qx, qy };
}
