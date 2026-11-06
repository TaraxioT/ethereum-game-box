// Names a revert by its contract error, decoded with the names ABIs.

import { type Abi, type Hex, BaseError, decodeErrorResult } from 'viem';

import {
  boxResultsAbi,
  defaultReverseRegistrarAbi,
  demoLicencesAbi,
  gameBoxNamesAbi,
  p256AccountAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  playerStatsAbi,
  universalResolverAbi,
  verifiableFactoryAbi,
} from '@egb/shared/names';

const errors: Abi = [
  gameBoxNamesAbi,
  playerStatsAbi,
  boxResultsAbi,
  defaultReverseRegistrarAbi,
  demoLicencesAbi,
  p256AccountAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  verifiableFactoryAbi,
  universalResolverAbi,
].flatMap((abi) => (abi as Abi).filter((item) => item.type === 'error'));

/** The revert data in a viem error, if the node returned any. */
export function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  let data: Hex | undefined;
  error.walk((e) => {
    const value = (e as { data?: unknown }).data;
    const raw = typeof value === 'object' && value !== null ? (value as { data?: unknown }).data : value;
    if (typeof raw === 'string' && raw.startsWith('0x') && raw.length >= 10) data = raw as Hex;
    return data !== undefined;
  });
  return data;
}

/** Whether `error` is a revert (as opposed to the RPC failing). */
export function isRevert(error: unknown): boolean {
  return revertData(error) !== undefined || /revert/i.test(error instanceof Error ? error.message : '');
}

/** The error's name, e.g. `LabelAlreadyRegistered`, `Error: <reason>`, or the raw selector if no ABI has it. */
export function revertName(error: unknown): string {
  const data = revertData(error);
  if (!data) return 'reverted without data';
  try {
    const { errorName, args } = decodeErrorResult({ abi: errors, data });
    if (errorName === 'Error') return `Error: ${String(args?.[0])}`;
    if (errorName === 'Panic') return `Panic: ${String(args?.[0])}`;
    return errorName;
  } catch {
    return `unknown error ${data.slice(0, 10)}`;
  }
}
