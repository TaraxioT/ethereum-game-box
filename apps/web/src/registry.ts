// Where a name lives in ENSv2: walks the registries from the root (`eth` → `gamebox` → …), then reads the leaf
// label's resolver, expiry, owner and token, and whether its registry is emancipated.
import { type Address, type PublicClient, keccak256, toHex, zeroAddress } from "viem";
import { ensAddress, permissionedRegistryAbi } from "@egb/shared/names";

/** A label's id in its registry: its labelhash as a number (any of a name's token ids works too). */
export function labelId(label: string): bigint {
  return BigInt(keccak256(toHex(label)));
}

/** `2^64 − 1`: the expiry of a name that never expires. */
export const FOREVER = 2n ** 64n - 1n;

/** The registry status values (`IPermissionedRegistry.Status`). */
export const STATUS = ["available", "reserved", "registered"] as const;
export type LabelStatus = (typeof STATUS)[number];

export interface Location {
  name: string;
  /** The registry that holds the leaf label, or null if a parent has no subregistry. */
  registry: Address | null;
  label: string;
  resolver: Address | null;
  status: LabelStatus;
  /** Unix seconds; `FOREVER` for a name that never expires. */
  expiry: bigint;
  owner: Address | null;
  tokenId: bigint;
  emancipated: boolean;
}

/** Locates `name` (e.g. `nova.gamebox.eth`), at `blockNumber` if given. */
export async function locate(client: PublicClient, name: string, blockNumber?: bigint): Promise<Location> {
  const labels = name.split(".");
  const leaf = labels[0] ?? "";
  let registry: Address | null = ensAddress("RootRegistry");
  for (const label of labels.slice(1).reverse()) {
    const sub: Address = await client.readContract({
      address: registry,
      abi: permissionedRegistryAbi,
      functionName: "getSubregistry",
      args: [label],
      blockNumber,
    });
    if (sub === zeroAddress) {
      registry = null;
      break;
    }
    registry = sub;
  }
  if (registry === null) {
    return { name, registry, label: leaf, resolver: null, status: "available", expiry: 0n, owner: null, tokenId: 0n, emancipated: false };
  }
  const at = { address: registry, abi: permissionedRegistryAbi, blockNumber } as const;
  const [resolver, state, emancipated] = await Promise.all([
    client.readContract({ ...at, functionName: "getResolver", args: [leaf] }),
    client.readContract({ ...at, functionName: "getState", args: [labelId(leaf)] }),
    client.readContract({ ...at, functionName: "isEmancipated" }).catch(() => false),
  ]);
  const status = STATUS[state.status] ?? "available";
  return {
    name,
    registry,
    label: leaf,
    resolver: resolver === zeroAddress ? null : resolver,
    status,
    expiry: BigInt(state.expiry),
    owner: status === "registered" && state.latestOwner !== zeroAddress ? state.latestOwner : null,
    tokenId: state.tokenId,
    emancipated,
  };
}
