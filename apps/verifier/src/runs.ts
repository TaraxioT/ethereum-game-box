// The pots a Box has opened, read from `StorePot`'s events: a judgement's Durable Object can't be listed.

import type { Client } from '@egb/relayer/chain';
import { storePotAbi } from '@egb/shared/store';
import type { Address, Hex } from 'viem';

export interface OpenedPot {
  readonly box: string;
  readonly round: string;
  readonly bundle: Hex;
  readonly players: readonly Address[];
  /** Each player's stake, in USDC base units. */
  readonly amount: string;
  /** Seconds since the epoch. */
  readonly openedAt: number;
}

/** Inside what RPC providers take for one `eth_getLogs`. */
const LOG_SPAN = 5000n;

export async function openedPots(client: Client, pot: Address, fromBlock: bigint): Promise<OpenedPot[]> {
  const head = await client.getBlockNumber();
  const spans: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= head; from += LOG_SPAN) {
    spans.push([from, from + LOG_SPAN - 1n > head ? head : from + LOG_SPAN - 1n]);
  }
  const found = await Promise.all(
    spans.map(([from, to]) =>
      client.getContractEvents({ address: pot, abi: storePotAbi, eventName: 'PotOpened', fromBlock: from, toBlock: to, strict: true }),
    ),
  );
  const logs = found.flat();
  const blocks = [...new Set(logs.map((log) => log.blockNumber))];
  const times = new Map(
    await Promise.all(
      blocks.map(async (blockNumber) => [blockNumber, Number((await client.getBlock({ blockNumber })).timestamp)] as const),
    ),
  );
  return logs.map(({ args, blockNumber }) => ({
    box: args.box,
    round: args.round.toString(),
    bundle: args.bundle,
    players: args.players,
    amount: args.amount.toString(),
    openedAt: times.get(blockNumber) ?? 0,
  }));
}

/** Remembers `load`'s answer for `ttlMs`, so an open page can't turn into a scan of the chain per request. */
export function remembered<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let kept: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (kept && now() - kept.at < ttlMs) return kept.value;
    const value = load();
    const entry = { at: now(), value };
    kept = entry;
    value.catch(() => {
      if (kept === entry) kept = null;
    });
    return value;
  };
}
