// Signed request bodies for the fake deployment in `world.ts`.

import {
  claimNameTypedData,
  executeDigest,
  fullName,
  permissionedResolverAbi,
  resultDigest,
  type Result,
} from '@egb/shared/names';
import { type Address, type Hex, encodeFunctionData, toHex } from 'viem';
import { type PrivateKeyAccount, generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { packetToBytes } from 'viem/ens';

import { BOX, BOX_ACCOUNT, BOX_RESOLVER, NOW, type World, addresses } from './world.ts';

export const newBadge = () => privateKeyToAccount(generatePrivateKey());

export async function claimBody(label: string, badge: PrivateKeyAccount, options: { deadline?: bigint; signer?: PrivateKeyAccount } = {}) {
  const deadline = options.deadline ?? BigInt(NOW + 600);
  const signature = await (options.signer ?? badge).signTypedData(
    claimNameTypedData({ label, badge: badge.address, deadline }, addresses.names),
  );
  return { label, badge: badge.address, deadline, signature };
}

export function setTextData(key: string, value: string, label = BOX): Hex {
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: 'setText',
    args: [toHex(packetToBytes(fullName(label))), key, value],
  });
}

export function executeBody(
  world: World,
  options: { data?: Hex; nonce?: bigint; target?: Address; account?: Address; value?: bigint; highS?: boolean; sign?: World['key'] } = {},
) {
  const call = {
    target: options.target ?? BOX_RESOLVER,
    value: options.value ?? 0n,
    data: options.data ?? setTextData('lastSeen', String(NOW)),
    nonce: options.nonce ?? 7n,
    deadline: BigInt(NOW + 600),
  };
  const account = options.account ?? BOX_ACCOUNT;
  const { r, s } = (options.sign ?? world.key).sign(executeDigest(call, account), { highS: options.highS });
  return { account, ...call, r, s };
}

export function resultBody(
  world: World,
  winner: Address,
  loser: Address,
  options: { round?: bigint; highS?: boolean; box?: string } = {},
) {
  const result: Result = {
    box: options.box ?? BOX,
    game: 'quickdraw',
    round: options.round ?? 1n,
    winner,
    loser,
    draw: false,
    deadline: BigInt(NOW + 600),
  };
  return { result, ...world.key.sign(resultDigest(result, addresses.results), { highS: options.highS }) };
}
