// The Box licences, read from chain: which labels exist (`BoxRegistered` events, from `GameBoxNames`' deploy block in
// chunks), and each Box's licence (`getBox`) with its records, read from its own resolver with `resolve`. A record is
// read from the Box's resolver and not through the Universal Resolver, so a lapsed licence still shows the Box's own
// values rather than `gamebox.eth`'s default.
import { type Address, type Hex, decodeFunctionResult, encodeFunctionData, getAbiItem, namehash, toHex } from "viem";
import { packetToBytes } from "viem/ens";
import {
  BOX_DEVICE_KEYS,
  BOX_OPERATOR_KEYS,
  BOX_STATUS,
  type BoxStatus,
  type P256PublicKey,
  fullName,
  gameBoxNamesAbi,
  permissionedResolverAbi,
  resolverProfilesAbi,
} from "@egb/shared/names";

import { client, gameBoxNames } from "./chain.ts";
import { LOG_CHUNK } from "./config.ts";

export type BoxKey = (typeof BOX_OPERATOR_KEYS)[number] | (typeof BOX_DEVICE_KEYS)[number];
export const BOX_RECORD_KEYS: readonly BoxKey[] = [...BOX_OPERATOR_KEYS, ...BOX_DEVICE_KEYS];

export interface BoxView {
  label: string;
  name: string;
  operator: Address;
  /** The Box's own `P256Account`. */
  account: Address;
  key: P256PublicKey;
  status: BoxStatus;
  /** Unix seconds. */
  expiry: number;
  resolver: Address;
  records: Record<BoxKey, string>;
}

/** The DNS-encoded name, as a resolver's `setText` and `resolve` take it. */
export function dnsName(label: string): Hex {
  return toHex(packetToBytes(fullName(label)));
}

/** `GameBoxNames.BoxStatus` (0 is "never a Box") as its record writes it. */
export function statusText(status: number): BoxStatus | null {
  return BOX_STATUS[status - 1] ?? null;
}

/** The `label` of every `BoxRegistered` (to `operator`, if given) or `GameAdded` event, oldest first, once each. */
async function eventLabels(name: "BoxRegistered" | "GameAdded", operator?: Address): Promise<string[]> {
  const names = gameBoxNames();
  if (!names) return [];
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const labels: string[] = [];
  for (let from = BigInt(names.deployBlock); from <= head; from += LOG_CHUNK + 1n) {
    const to = from + LOG_CHUNK > head ? head : from + LOG_CHUNK;
    const logs =
      name === "BoxRegistered"
        ? await client.getLogs({
            address: names.address,
            event: getAbiItem({ abi: gameBoxNamesAbi, name }),
            args: operator ? { operator } : undefined,
            fromBlock: from,
            toBlock: to,
          })
        : await client.getLogs({ address: names.address, event: getAbiItem({ abi: gameBoxNamesAbi, name }), fromBlock: from, toBlock: to });
    for (const log of logs) if (log.args.label && !labels.includes(log.args.label)) labels.push(log.args.label);
  }
  return labels;
}

/** The labels of every Box licence ever issued, oldest first; only those issued to `operator` if given. */
export function boxLabels(operator?: Address): Promise<string[]> {
  return eventLabels("BoxRegistered", operator);
}

/** The games a Box may offer: every `<game>.gamebox.eth`. */
export function gameLabels(): Promise<string[]> {
  return eventLabels("GameAdded");
}

async function readText(resolver: Address, label: string, key: string, blockNumber?: bigint): Promise<string> {
  const data = encodeFunctionData({ abi: resolverProfilesAbi, functionName: "text", args: [namehash(fullName(label)), key] });
  const answer = await client.readContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "resolve",
    args: [dnsName(label), data],
    blockNumber,
  });
  return decodeFunctionResult({ abi: resolverProfilesAbi, functionName: "text", data: answer });
}

/** A Box's licence and records, or null if the label was never a Box. `blockNumber` reads at a write's block. */
export async function readBox(label: string, blockNumber?: bigint): Promise<BoxView | null> {
  const names = gameBoxNames();
  if (!names) return null;
  const box = await client.readContract({
    address: names.address,
    abi: gameBoxNamesAbi,
    functionName: "getBox",
    args: [label],
    blockNumber,
  });
  const status = statusText(box.status);
  if (!status) return null;
  const values = await Promise.all(BOX_RECORD_KEYS.map((key) => readText(box.resolver, label, key, blockNumber)));
  return {
    label,
    name: fullName(label),
    operator: box.operator,
    account: box.account,
    key: { qx: box.qx, qy: box.qy },
    status,
    expiry: Number(box.expiry),
    resolver: box.resolver,
    records: Object.fromEntries(BOX_RECORD_KEYS.map((key, i) => [key, values[i] ?? ""])) as Record<BoxKey, string>,
  };
}
