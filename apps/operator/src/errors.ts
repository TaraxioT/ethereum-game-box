// A revert decoded to its error name, from the ABIs of everything an operator's or admin's call reaches, so a refusal
// reads as `EACUnauthorizedAccountRoles` and not as hex.
import { type Abi, BaseError, decodeErrorResult, type Hex } from "viem";
import {
  gameBoxNamesAbi,
  p256AccountAbi,
  p256AccountFactoryAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
} from "@egb/shared/names";

const errorsAbi = [
  ...gameBoxNamesAbi,
  ...p256AccountAbi,
  ...p256AccountFactoryAbi,
  ...permissionedRegistryAbi,
  ...permissionedResolverAbi,
].filter((item) => item.type === "error") as Abi;

/** The error's name for a person: the decoded revert if there is one, else a short message. */
export function errorName(err: unknown): string {
  let data: Hex | null = null;
  const look = (e: unknown): boolean => {
    const value = (e as { data?: unknown } | null)?.data;
    if (typeof value === "string" && value.startsWith("0x") && value.length >= 10) data = value as Hex;
    return data !== null;
  };
  if (err instanceof BaseError) err.walk(look);
  if (data) {
    try {
      return decodeErrorResult({ abi: errorsAbi, data }).errorName;
    } catch {
      // Not one of ours: fall through to the message.
    }
  }
  if (err instanceof BaseError) return err.shortMessage;
  if (err instanceof DOMException && err.name === "NotAllowedError") return "The passkey prompt was closed";
  return err instanceof Error ? err.message.split("\n")[0]! : String(err);
}
