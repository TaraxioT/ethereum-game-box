// A store game's match log: what the verifier judges. The Box writes every entry. `src: "box"` is what the Box itself
// saw; `src: "game"` is what the game's own page claimed, which a rigged game can make up.

export interface LogHeader {
  readonly v: 1;
  /** The Box's label, such as `mumbai-01`. */
  readonly box: string;
  /** The pot's round, a decimal uint256. */
  readonly round: string;
  /** The bundle's sha256, as `0x` hex. */
  readonly bundle: `0x${string}`;
  /** The manifest's id. */
  readonly game: string;
  /** Each seat's address, in seat order. A verdict's payouts follow this order. */
  readonly players: readonly `0x${string}`[];
  /** Each player's stake in USDC base units (6 decimals), a decimal string. */
  readonly amount: string;
  /** ms since the epoch, the Box's clock. */
  readonly startedAt: number;
}

export type LogEntry =
  /** A badge's tap. `roll` is its verified roll, on `random` taps. */
  | { readonly src: "box"; readonly t: "tap"; readonly seat: number; readonly at: number; readonly roll: number | null }
  /** The match closed: the game called `end()`, the manifest's time ran out, or the frame was lost. */
  | { readonly src: "box"; readonly t: "end"; readonly at: number; readonly why: "game" | "time" | "lost" }
  /** Something the game posted. `at` is the Box's clock on arrival. */
  | { readonly src: "game"; readonly t: "event"; readonly at: number; readonly name: string; readonly data: unknown };

export interface MatchLog {
  readonly header: LogHeader;
  readonly entries: readonly LogEntry[];
}

export const LOG_LIMITS = { entries: 5000, eventName: 40, eventDataBytes: 1024, logBytes: 1024 * 1024 } as const;
