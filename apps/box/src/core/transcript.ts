// A finished match as one transcript line for the session log, and whether its result counts toward records.
//
// A result counts only on the evidence of taps the Box saw (the free-result rules): every seated badge tapped a
// station from Stake to the end of the match, at least FREE_MIN_MATCH_MS passed since the first of those taps, and
// the badges have had fewer than FREE_PER_PAIR_HOUR counted results together in the hour before. Injected taps and Demo mode's screen
// are no evidence; a result that doesn't count is still logged. Pure.
import type { DuelSeat, Transcript, TranscriptTap } from "@egb/sdk";
import type { MarketSource } from "../games/stock-duel/types.ts";
import type { MatchLog } from "./ports.ts";

export const FREE_MIN_MATCH_MS = 12_000;
export const FREE_PER_PAIR_HOUR = 12;
const HOUR_MS = 3_600_000;

export interface MatchRecord {
  readonly match: number;
  readonly game: string;
  readonly seed: number;
  /** Each player's badge (key-2 address), in seat order. */
  readonly badges: readonly string[];
  readonly stake: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly taps: readonly TranscriptTap[];
  readonly winner: DuelSeat | null;
  /** The built game's rules failed: no result, both stakes back. */
  readonly voided: boolean;
  /** The first station tap each player's badge made from Stake on, or null for none. */
  readonly seen: readonly (number | null)[];
  /** Stock Duel Uniswap's live numbers: the Robinhood Chain block they were read at. Null for the frozen deck and other games. */
  readonly market?: MarketSource | null;
}

/** Whether a match's result counts toward records. */
export function counts(record: MatchRecord, log: Pick<MatchLog, "countedSince">): boolean {
  const seen = record.seen.filter((at) => at !== null);
  if (record.voided || seen.length < record.seen.length) return false;
  if (record.endedAt - Math.min(...seen) < FREE_MIN_MATCH_MS) return false;
  return log.countedSince(record.badges, record.endedAt - HOUR_MS) < FREE_PER_PAIR_HOUR;
}

export function transcriptOf(record: MatchRecord, log: Pick<MatchLog, "countedSince">): Transcript {
  return {
    v: 1,
    match: record.match,
    game: record.game,
    seed: record.seed,
    badges: record.badges,
    stake: record.stake,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    taps: record.taps,
    result: record.voided ? "void" : { winner: record.winner },
    counts: counts(record, log),
    ...(record.market ? { market: { chainId: record.market.chainId, block: record.market.block } } : {}),
  };
}
