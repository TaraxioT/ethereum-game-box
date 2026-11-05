// A match's transcript: one JSON line per match in $EGB_DATA/sessions/YYYY-MM-DD.jsonl. Records rebuild from it.
import type { Seat } from "./seat.ts";

export interface TranscriptTap {
  readonly seat: Seat;
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
  /** Each seat's badge identity (key-2 address). */
  readonly badges: readonly [string, string];
  readonly stake: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly taps: readonly TranscriptTap[];
  /** `void`: the rules failed (over budget or crashed) and both stakes went back. */
  readonly result: { readonly winner: Seat | null } | "void";
  /** The match counts toward records (free-result rules: both badges tapped, ≥ 12 s, ≤ 12 per pair per hour). */
  readonly counts: boolean;
}
