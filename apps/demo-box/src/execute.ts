// The `POST /account/execute` body for calls a `P256Account`'s software key runs: one call as `execute`, several as
// one `executeBatch` under one signature. Both the Box and the agent write their records this way.

import {
  type Call,
  type CallJson,
  type ExecuteRequest,
  executeBatchDigest,
  executeDigest,
  fullName,
  permissionedResolverAbi,
} from '@egb/shared/names';
import { type Address, encodeFunctionData, toHex } from 'viem';
import { packetToBytes } from 'viem/ens';

import type { Signer } from './signer.ts';

/** `PermissionedResolver.setText` of `key` on `<label>.gamebox.eth`, at `resolver`. */
export function setTextCall(resolver: Address, label: string, key: string, value: string): Call {
  return {
    target: resolver,
    value: 0n,
    data: encodeFunctionData({
      abi: permissionedResolverAbi,
      functionName: 'setText',
      args: [toHex(packetToBytes(fullName(label))), key, value],
    }),
  };
}

const json = ({ target, value, data }: Call): CallJson => ({ target, value: String(value), data });

/** `calls` for `account`, signed raw by `signer`. */
export function signedExecute(signer: Signer, account: Address, calls: Call[], nonce: bigint, deadline: bigint): ExecuteRequest {
  const signed = { account, nonce: String(nonce), deadline: String(deadline) };
  const [only] = calls;
  if (calls.length === 1 && only) {
    return { ...signed, signature: signer.raw(executeDigest({ ...only, nonce, deadline }, account)), call: json(only) };
  }
  return { ...signed, signature: signer.raw(executeBatchDigest({ calls, nonce, deadline }, account)), calls: calls.map(json) };
}
