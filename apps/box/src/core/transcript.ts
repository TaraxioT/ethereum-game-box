// A finished match as one transcript line for the session log, and whether its result counts toward records.
//
// A result counts only on the evidence of taps the Box saw (the free-result rules): both seated badges tapped a
// station from Stake to the end of the match, at least FREE_MIN_MATCH_MS passed since the first of those taps, and
// the pair has had fewer than FREE_PER_PAIR_HOUR counted results in the hour before. Injected taps and the demo's desk
// are no evidence; a result that doesn't count is still logged. Pure.
import type { Seat, Transcript, TranscriptTap } from "@egb/sdk";
import type { MatchLog } from "./ports.ts";

export const FREE_MIN_MATCH_MS = 12_000;
export const FREE_PER_PAIR_HOUR = 12;
const HOUR_MS = 3_600_000;

export interface MatchRecord {
  readonly match: number;
  readonly game: string;
  readonly seed: number;
  /** Each seat's badge (key-2 address). */
  readonly badges: readonly [string, string];
  readonly stake: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly taps: readonly TranscriptTap[];
  readonly winner: Seat | null;
  /** The first station tap each seated badge made from Stake on, or null for none. */
  readonly seen: readonly [number | null, number | null];
}

/** Whether a match's result counts toward records. */
export function counts(record: MatchRecord, log: Pick<MatchLog, "countedSince">): boolean {
  const [one, two] = record.seen;
  if (one === null || two === null) return false;
  if (record.endedAt - Math.min(one, two) < FREE_MIN_MATCH_MS) return false;
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
    result: { winner: record.winner },
    counts: counts(record, log),
  };
}
