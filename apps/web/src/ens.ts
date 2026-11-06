// The ENS reads, in one place: stock viem through ENSv2's Universal Resolver. A name that doesn't resolve (expired,
// never registered, no resolver) reads as null, and nothing is cached, so a lapsed name never shows a stale value.
import type { Address, PublicClient } from "viem";
import { ensAddress } from "@egb/shared/names";

const universalResolverAddress = ensAddress("UniversalResolver");

/** The name's `addr`, or null if it doesn't resolve or has none. */
export async function readAddress(client: PublicClient, name: string, blockNumber?: bigint): Promise<Address | null> {
  const address = await client.getEnsAddress({ name, universalResolverAddress, blockNumber });
  return address ?? null;
}

/** A text record, or null if the name doesn't resolve or the record is empty. */
export async function readText(
  client: PublicClient,
  name: string,
  key: string,
  blockNumber?: bigint,
): Promise<string | null> {
  const value = await client.getEnsText({ name, key, universalResolverAddress, blockNumber });
  return value === null || value === "" ? null : value;
}

/** Several text records of one name, read together. */
export async function readTexts<K extends string>(
  client: PublicClient,
  name: string,
  keys: readonly K[],
  blockNumber?: bigint,
): Promise<Record<K, string | null>> {
  const values = await Promise.all(keys.map((key) => readText(client, name, key, blockNumber)));
  return Object.fromEntries(keys.map((key, i) => [key, values[i] ?? null])) as Record<K, string | null>;
}

/** The address's primary name (ENS reverse resolution, checked forward by viem), or null. */
export async function readPrimaryName(client: PublicClient, address: Address): Promise<string | null> {
  return (await client.getEnsName({ address, universalResolverAddress })) ?? null;
}
