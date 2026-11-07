// A match's transcript: one JSON line per match in $EGB_DATA/sessions/YYYY-MM-DD.jsonl. Records rebuild from it.
import type { DuelSeat } from "./seat.ts";

export interface TranscriptTap {
  /** Whose tap: a place in `badges`. */
  readonly seat: number;
  /** When the chip touched the reader (ms since the epoch, the Box's clock). */
  readonly at: number;
  /** The badge's verified roll, for `random` taps. */
  readonly roll: number | null;
  /** Whether the rules took the tap. */
  readonly accepted: boolean;
}

export interface Transcript {
  readonly v: 1;
  readonly match: number;
  readonly game: string;
  readonly seed: number;
  /** Each player's badge identity (key-2 address), in seat order: two, or up to four in a store match. */
  readonly badges: readonly string[];
  readonly stake: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly taps: readonly TranscriptTap[];
  /** `void`: the rules failed (over budget or crashed) and every stake went back; a store match, which has no winner, too. */
  readonly result: { readonly winner: DuelSeat | null } | "void";
  /** The match counts toward records (free-result rules: every badge tapped, ≥ 12 s, ≤ 12 per pair per hour). */
  readonly counts: boolean;
  /**
   * Stock Duel's replay proof: the chain and block its numbers were read at (deployments/robinhood.json's pools; the
   * day's samples run back 24 hours from it). Absent when the match dealt the frozen deck.
   */
  readonly market?: { readonly chainId: number; readonly block: number };
}
