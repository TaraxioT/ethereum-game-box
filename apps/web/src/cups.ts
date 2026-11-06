// A championship as its name reads through ENS: `<label>.<game>.gamebox.eth` and the records `Championships` writes on
// its own resolver (`ends`, `prize`, `standings`, `leader`, `winner`, and `addr`, the leader's then the winner's badge).
// While it runs the records move with every result; once closed, nobody holds a role on that resolver, so they are
// frozen, and the winner holds the name with no expiry.
import type { Address, PublicClient } from "viem";
import { CUP_KEYS, type Standing, parseStandings } from "@egb/shared/names";

import type { CupEntry } from "./directory.ts";
import { readAddress, readTexts } from "./ens.ts";
import { type Location, locate } from "./registry.ts";

export interface CupView {
  entry: CupEntry;
  /** `addr`: the leader's badge while it runs, the winner's once closed; null before the first result. */
  addr: Address | null;
  /** The top 5 in rank order, or null if the record is missing or isn't the shape `Championships` writes. */
  standings: Standing[] | null;
  leader: string | null;
  winner: string | null;
  /** Unix seconds, from the `ends` record. */
  ends: bigint | null;
  /** USDC base units, from the `prize` record. */
  prize: bigint | null;
  /** Where the name lives: the winner's token, with no expiry, once closed. */
  where: Location;
}

/** A record that should hold an integer, or null. */
export function recordInt(text: string | null): bigint | null {
  return text !== null && /^\d+$/.test(text) ? BigInt(text) : null;
}

/** A `standings` record, or null when it is missing or malformed. */
export function readStandings(text: string | null): Standing[] | null {
  if (text === null) return null;
  try {
    return parseStandings(text);
  } catch {
    return null;
  }
}

/** Every read at one block, so the records agree with each other even when the public RPCs answer from nodes a
 * block apart. */
export async function readCup(client: PublicClient, entry: CupEntry, blockNumber: bigint): Promise<CupView> {
  const [addr, records, where] = await Promise.all([
    readAddress(client, entry.name, blockNumber),
    readTexts(client, entry.name, Object.values(CUP_KEYS), blockNumber),
    locate(client, entry.name, blockNumber),
  ]);
  return {
    entry,
    addr,
    standings: readStandings(records.standings),
    leader: records.leader,
    winner: records.winner,
    ends: recordInt(records.ends),
    prize: recordInt(records.prize),
    where,
  };
}
