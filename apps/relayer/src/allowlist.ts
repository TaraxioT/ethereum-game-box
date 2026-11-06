// The calls an account may have the relayer pay for through `P256Account.execute` or `executeBatch`:
// - any call to a contract in `deployments/sepolia.json` (`targets.ts`);
// - a record write (`setText`, `setAddress`, `linkToNode`, `linkToRecord`) on a `<label>.gamebox.eth` name, sent to
//   that name's own resolver (checked on chain by the route);
// - `rotateKey` on the account itself, to a point on P-256.
// None may send ETH. Whatever the call, its `eth_call` must then succeed.

import { PARENT_NAME, type Call, labelProblem, p256AccountAbi, permissionedResolverAbi } from '@egb/shared/names';
import { type Address, type Hex, bytesToString, decodeFunctionData, hexToBytes, isAddressEqual } from 'viem';

import { Refusal } from './refusal.ts';
import { isP256Point } from './verify.ts';

/** Why a call is allowed. A `resolver` call still needs its target to be the name's resolver on chain. */
export type Allowed = { kind: 'deployed' } | { kind: 'self' } | { kind: 'resolver'; label: string };

/** The resolver functions an account may call: each names the record it writes as its first argument. */
const RECORD_WRITES = new Set(['setText', 'setAddress', 'linkToNode', 'linkToRecord']);

/** The labels of a DNS-encoded name, or `null` if it is not well formed. */
export function dnsLabels(name: Hex): string[] | null {
  const bytes = hexToBytes(name);
  const labels: string[] = [];
  let at = 0;
  while (at < bytes.length) {
    const length = bytes[at]!;
    if (length === 0) return at === bytes.length - 1 ? labels : null;
    labels.push(bytesToString(bytes.subarray(at + 1, at + 1 + length)));
    at += 1 + length;
  }
  return null;
}

/** `<label>` of a DNS-encoded `<label>.gamebox.eth`, or `null`. */
function gameBoxLabel(name: Hex): string | null {
  const [label, ...parent] = dnsLabels(name) ?? [];
  return label && parent.join('.') === PARENT_NAME && !labelProblem(label) ? label : null;
}

function selfCall(data: Hex): Allowed {
  let call;
  try {
    call = decodeFunctionData({ abi: p256AccountAbi, data });
  } catch {
    throw new Refusal(403, 'a call to the account itself must be rotateKey');
  }
  if (call.functionName !== 'rotateKey') throw new Refusal(403, 'a call to the account itself must be rotateKey');
  const [qx, qy] = call.args;
  if (!isP256Point(qx, qy)) throw new Refusal(400, 'rotateKey: the new key is not a point on P-256');
  return { kind: 'self' };
}

function recordWrite(data: Hex): Allowed {
  let call;
  try {
    call = decodeFunctionData({ abi: permissionedResolverAbi, data });
  } catch {
    throw new Refusal(403, `the target is not in deployments/sepolia.json, and the call is not a record write`);
  }
  if (!RECORD_WRITES.has(call.functionName)) {
    throw new Refusal(403, `${call.functionName} is not on the allowlist: on a name's resolver, only record writes`);
  }
  const label = gameBoxLabel((call.args as readonly unknown[])[0] as Hex);
  if (!label) throw new Refusal(403, `the record is not on a <label>.${PARENT_NAME} name`);
  return { kind: 'resolver', label };
}

/** Why `call` from `account` is allowed, or a 403 (400 for a malformed key) if it isn't. */
export function allowedCall(call: Call, account: Address, deployed: ReadonlySet<string>): Allowed {
  if (call.value !== 0n) throw new Refusal(403, 'value must be 0: the relayer moves no ETH');
  if (isAddressEqual(call.target, account)) return selfCall(call.data);
  if (deployed.has(call.target.toLowerCase())) return { kind: 'deployed' };
  return recordWrite(call.data);
}
