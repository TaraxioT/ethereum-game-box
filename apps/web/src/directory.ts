// Every name under gamebox.eth, listed from `GameBoxNames`' events: read from its deploy block in chunks, then
// topped up from where the last read stopped. There is no index server; the chain is the list.
import { type Address, type Hex, type Log, type PublicClient, getAbiItem, getAddress } from "viem";
import { contractAddress, gameBoxNamesAbi, ourContract } from "@egb/shared/names";

import { LOG_CHUNK } from "./config.ts";

export interface BoxEntry {
  label: string;
  operator: Address;
  account: Address;
  resolver: Address;
  /** The block of its latest licence. */
  block: bigint;
}

export interface PlayerEntry {
  label: string;
  badge: Address;
  resolver: Address;
  block: bigint;
}

export interface GameEntry {
  label: string;
  titleRegistry: Address;
  titleTerm: bigint;
}

/** A champion's win, from `Crowned`. */
export interface Crowning {
  game: string;
  winner: Address;
  /** The holder it took the title from, or zero (a first crown, or the holder kept it). */
  previous: Address;
  round: bigint;
  streak: bigint;
  expiry: bigint;
  block: bigint;
  hash: Hex;
}

export interface Directory {
  boxes: Map<string, BoxEntry>;
  players: Map<string, PlayerEntry>;
  /** A badge's player label, lower-cased address to label. */
  labelOf: Map<string, string>;
  games: Map<string, GameEntry>;
  /** Every crowning, oldest first. */
  crowns: Crowning[];
  /** The last block read. */
  through: bigint;
}

const EVENTS = [
  getAbiItem({ abi: gameBoxNamesAbi, name: "BoxRegistered" }),
  getAbiItem({ abi: gameBoxNamesAbi, name: "PlayerClaimed" }),
  getAbiItem({ abi: gameBoxNamesAbi, name: "GameAdded" }),
  getAbiItem({ abi: gameBoxNamesAbi, name: "Crowned" }),
];

export function emptyDirectory(from: bigint): Directory {
  return { boxes: new Map(), players: new Map(), labelOf: new Map(), games: new Map(), crowns: [], through: from - 1n };
}

type NamesLog = Log<bigint, number, false, (typeof EVENTS)[number], true>;

/** Folds one event into the directory. Exported for tests. */
export function apply(dir: Directory, log: NamesLog): void {
  const block = log.blockNumber ?? 0n;
  switch (log.eventName) {
    case "BoxRegistered": {
      const { label, operator, account, resolver } = log.args;
      dir.boxes.set(label, { label, operator, account, resolver, block });
      break;
    }
    case "PlayerClaimed": {
      const { label, badge, resolver } = log.args;
      dir.players.set(label, { label, badge, resolver, block });
      dir.labelOf.set(badge.toLowerCase(), label);
      break;
    }
    case "GameAdded": {
      const { label, titleRegistry, titleTerm } = log.args;
      dir.games.set(label, { label, titleRegistry, titleTerm });
      break;
    }
    case "Crowned": {
      const { game, winner, previous, round, streak, expiry } = log.args;
      dir.crowns.push({ game, winner, previous, round, streak, expiry, block, hash: log.transactionHash ?? "0x" });
      break;
    }
  }
}

/** Reads every event after `dir.through` up to `head`, in chunks of `LOG_CHUNK` blocks. */
export async function catchUp(client: PublicClient, dir: Directory, head: bigint): Promise<void> {
  const address = contractAddress("GameBoxNames");
  for (let from = dir.through + 1n; from <= head; from += LOG_CHUNK + 1n) {
    const to = from + LOG_CHUNK > head ? head : from + LOG_CHUNK;
    const logs = (await client.getLogs({ address, events: EVENTS, fromBlock: from, toBlock: to, strict: true })) as NamesLog[];
    for (const log of logs) apply(dir, log);
    dir.through = to;
  }
}

let shared: Directory | null = null;
let pending: Promise<Directory> | null = null;

/** The directory, brought up to `head` (one read at a time; callers share it). */
export function directory(client: PublicClient, head: bigint): Promise<Directory> {
  if (pending) return pending;
  const deploy = ourContract("GameBoxNames");
  if (!deploy) return Promise.reject(new Error("GameBoxNames is not deployed yet"));
  shared ??= emptyDirectory(BigInt(deploy.deployBlock));
  const dir = shared;
  if (dir.through >= head) return Promise.resolve(dir);
  pending = catchUp(client, dir, head)
    .then(() => dir)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The player label a badge holds, if the directory has seen it. */
export function playerLabel(dir: Directory, badge: Address | null): string | null {
  return badge ? (dir.labelOf.get(getAddress(badge).toLowerCase()) ?? null) : null;
}
