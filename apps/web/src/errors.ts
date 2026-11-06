// Decodes a revert to its error name, from every names and USDC ABI and the ENSv2 slice, so a refusal reads as
// `EACUnauthorizedAccountRoles` and not as hex.
import { type Abi, type Hex, BaseError, decodeErrorResult } from "viem";
import {
  boxResultsAbi,
  boxSeatsAbi,
  championshipsAbi,
  demoLicencesAbi,
  duelPotAbi,
  fakeUsdcAbi,
  gameBoxNamesAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  playerStatsAbi,
  universalResolverAbi,
} from "@egb/shared/names";

const errorsAbi = [
  ...gameBoxNamesAbi,
  ...playerStatsAbi,
  ...boxResultsAbi,
  ...demoLicencesAbi,
  ...championshipsAbi,
  ...duelPotAbi,
  ...fakeUsdcAbi,
  ...boxSeatsAbi,
  ...permissionedRegistryAbi,
  ...permissionedResolverAbi,
  ...universalResolverAbi,
].filter((item) => item.type === "error") as Abi;

/** A decoded revert: its name and arguments. */
export interface Revert {
  name: string;
  args: readonly unknown[];
}

/** Decodes revert data, or null if no known error matches it. */
export function decodeRevert(data: Hex): Revert | null {
  if (data.length < 10) return null;
  try {
    const { errorName, args } = decodeErrorResult({ abi: errorsAbi, data });
    return { name: errorName, args: args ?? [] };
  } catch {
    return null;
  }
}

/** The revert data inside a viem error (it sits at different depths for different errors), if any. */
export function revertData(err: unknown): Hex | null {
  let found: Hex | null = null;
  const look = (e: unknown): boolean => {
    const data = (e as { data?: unknown } | null)?.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      found = data as Hex;
      return true;
    }
    if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      found = (data as { data: Hex }).data;
      return true;
    }
    return false;
  };
  if (err instanceof BaseError) err.walk(look);
  else look(err);
  return found;
}

/** The error's name for a person: the decoded revert if there is one, else viem's short message. */
export function errorName(err: unknown): string {
  const data = revertData(err);
  const revert = data ? decodeRevert(data) : null;
  if (revert) return revert.name;
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}
