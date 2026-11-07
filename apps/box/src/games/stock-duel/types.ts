// Stock Duel's state and events, shared by Stock Duel and Stock Duel Uniswap. The rules (rules.ts) are pure: time and
// badge rolls arrive in events. The cards are the deck's (built/deck.ts), shared with Stock Duel's built form. Stock
// Duel deals their frozen numbers; Stock Duel Uniswap, on a Box that reads Robinhood Chain, deals the pools' numbers
// at a block (live.ts), handed to the rules when the match starts.
import type { DuelSeat } from "@egb/sdk";
import type { StatKey, Stock } from "./built/deck.ts";

export type { StatKey, Stock };

export type StockDuelPhase = "deal" | "pick" | "dial" | "reveal" | "over";

/** The front card a touch froze, and when the chip touched. */
export interface HeldCard {
  readonly card: Stock;
  readonly at: number;
}

export interface RoundRecord {
  readonly cards: readonly [Stock, Stock];
  readonly stat: StatKey;
  /** null: a tie, replayed with the next cards. */
  readonly winner: DuelSeat | null;
}

/** Where a match's numbers came from: Robinhood Chain's stock pools at a block. */
export interface MarketSource {
  readonly chainId: number;
  readonly block: number;
  /** The block's time (ms since the epoch). */
  readonly at: number;
}

/** The deck with live numbers, and the block they were read at. */
export interface LiveDeck {
  readonly cards: readonly Stock[];
  readonly source: MarketSource;
}

export interface StockDuelState {
  /** The deck this match deals from, in deck order: the bars rank a card against it. */
  readonly deck: readonly Stock[];
  /** The block the numbers were read at, or null for the frozen deck. */
  readonly market: MarketSource | null;
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
  /** A seat whose chip is on the reader and still rolling: the card its front showed at the touch, held there. */
  readonly held: readonly [HeldCard | null, HeldCard | null];
  /** Each seat's latest badge roll (uint32). */
  readonly rolls: readonly [number, number];
  /** Chosen after both cards are down. */
  readonly stat: StatKey | null;
  readonly history: readonly RoundRecord[];
  /** Set when phase is `over`: the match winner, or null for a draw. */
  readonly winner: DuelSeat | null;
}

/**
 * A tap is a `touch` (the chip landed: its seat's front card freezes on the card the player saw), then a `tap` once
 * the chip's verified roll is back (the held card is played at the touch time), or a `release` when it never came
 * (the Rolodex turns on). `now` on `touch` and `tap` is when the chip touched the reader.
 */
export type StockDuelEvent =
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "touch"; readonly seat: DuelSeat; readonly now: number }
  /** Plays the held card (or, with no touch before it, the card in front at `now`). `roll` is the badge's number. */
  | { readonly type: "tap"; readonly seat: DuelSeat; readonly now: number; readonly roll: number }
  | { readonly type: "release"; readonly seat: DuelSeat };
