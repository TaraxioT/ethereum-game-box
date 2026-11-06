// Stock Duel's state and events. The rules (rules.ts) are pure: time and badge rolls arrive in events.
import type { Seat } from "@egb/sdk";

/** The four stats a round can be played on, in roll order: `(roll1 + roll2) % 4` picks one. */
export type StatKey = "price" | "avgPrice" | "change24h" | "liquidity";

export interface Stock {
  readonly ticker: string;
  readonly name: string;
  /** The brand colour, for the card's band and tab. */
  readonly colour: string;
  /** USD, the pool's spot price. */
  readonly price: number;
  /** USD, the 24-hour average price. */
  readonly avgPrice: number;
  /** Percent over 24 hours. */
  readonly change24h: number;
  /** USD in the pool. */
  readonly liquidity: number;
}

export type StockDuelPhase = "deal" | "pick" | "dial" | "reveal" | "over";

export interface RoundRecord {
  readonly cards: readonly [Stock, Stock];
  readonly stat: StatKey;
  /** null: a tie, replayed with the next cards. */
  readonly winner: Seat | null;
}

export interface StockDuelState {
  readonly phase: StockDuelPhase;
  /** When the current phase began (ms since the epoch). */
  readonly phaseAt: number;
  /** 1-based play number (ties count). */
  readonly round: number;
  readonly score: readonly [number, number];
  /** Each seat's cards still in hand, in Rolodex order. */
  readonly hands: readonly [readonly Stock[], readonly Stock[]];
  /** How long each card stays at the front of the Rolodex, this round. */
  readonly dwellMs: number;
  /** When each seat's Rolodex last started from its first card: the front card follows from the clock. */
  readonly drumAt: readonly [number, number];
  /** The card each seat played this round, or null. */
  readonly played: readonly [Stock | null, Stock | null];
  /** Whether a card was played for that seat when its time ran out. */
  readonly auto: readonly [boolean, boolean];
  /** Once one seat has played: when the other's card is played for them. */
  readonly deadline: number | null;
  /** Each seat's latest badge roll (uint32). */
  readonly rolls: readonly [number, number];
  /** Chosen after both cards are down. */
  readonly stat: StatKey | null;
  readonly history: readonly RoundRecord[];
  /** Set when phase is `over`: the match winner, or null for a draw. */
  readonly winner: Seat | null;
}

export type StockDuelEvent =
  | { readonly type: "tick"; readonly now: number }
  /** A badge tap: plays the front card. `roll` is the badge's signed random number. */
  | { readonly type: "tap"; readonly seat: Seat; readonly now: number; readonly roll: number };
