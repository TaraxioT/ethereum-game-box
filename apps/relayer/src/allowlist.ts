// The only calls a Box may have the relayer pay for through `BoxAccount.execute`: `PermissionedResolver.setText` of
// one of the Box's own keys (`lastSeen`, `game`) on a `<box>.gamebox.eth` name.

import { BOX_DEVICE_KEYS, PARENT_NAME, labelProblem, permissionedResolverAbi } from '@egb/shared/names';
import { type Hex, bytesToString, decodeFunctionData, hexToBytes } from 'viem';

import { Refusal } from './refusal.ts';

export interface DeviceWrite {
  /** The Box's label, e.g. `mumbai-01`. */
  label: string;
  key: (typeof BOX_DEVICE_KEYS)[number];
  value: string;
}

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

/** The Box write `data` makes, or a 403 if `data` is anything else. */
export function deviceWrite(data: Hex): DeviceWrite {
  let call;
  try {
    call = decodeFunctionData({ abi: permissionedResolverAbi, data });
  } catch {
    throw new Refusal(403, 'selector is not on the allowlist: only PermissionedResolver.setText');
  }
  if (call.functionName !== 'setText') {
    throw new Refusal(403, `${call.functionName} is not on the allowlist: only PermissionedResolver.setText`);
  }
  const [name, key, value] = call.args;
  if (!(BOX_DEVICE_KEYS as readonly string[]).includes(key)) {
    throw new Refusal(403, `key ${JSON.stringify(key)} is not on the allowlist: only ${BOX_DEVICE_KEYS.join(', ')}`);
  }
  const labels = dnsLabels(name);
  const [label, ...parent] = labels ?? [];
  if (!label || parent.join('.') !== PARENT_NAME || labelProblem(label)) {
    throw new Refusal(403, `the name is not a <box>.${PARENT_NAME} name`);
  }
  return { label, key: key as DeviceWrite['key'], value };
}
