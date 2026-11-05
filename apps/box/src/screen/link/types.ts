// The one interface between the screen and the Box. The screen reads `BoxState`, hears `BoxEvent`s and sends
// `ScreenCommand`s; whatever runs the Box (the simulated one today, the Box server later) sits behind `BoxLink`.
import type { Seat } from "../../games/seat.ts";
import type { QuickDrawState } from "../../games/quick-draw/types.ts";
import type { StockDuelState } from "../../games/stock-duel/types.ts";

export type { Seat };

export type GameId = "quick-draw" | "stock-duel" | "bet-on-x" | "b17";
/** The games the Box can run today. */
export type PlayableGameId = "quick-draw" | "stock-duel";

export interface GameInfo {
  readonly id: GameId;
  readonly title: string;
  readonly players: number;
  /** A typical match, in minutes. */
  readonly minutes: number;
  /** The stakes the Box offers, in EGB. */
  readonly stakes: readonly number[];
  readonly tier: "refereed" | "verified";
  /** false: sealed on Home with a SOON plate; Play stays dark. */
  readonly ready: boolean;
}

export interface Badge {
  readonly address: `0x${string}`;
  /** Its name under gamebox.eth, e.g. `nova.gamebox.eth`. */
  readonly name: string;
}

export interface SeatState {
  readonly badge: Badge | null;
  /** EGB, whole tokens. */
  readonly balance: number;
  /** EGB on its way to this badge: a faucet, payout or refund not yet in a block. */
  readonly pending: number;
  /** This seat has signed the entry for the match being staked. */
  readonly signed: boolean;
}

export interface ChainState {
  readonly block: number;
  /** When `block` was sealed (ms since the epoch). */
  readonly blockAt: number;
  /** Milliseconds between blocks. */
  readonly blockMs: number;
  readonly gasGwei: number;
}

export type TxKind = "faucet" | "open" | "settle" | "refund";
export type TxStep = "signed" | "sent" | "in-block" | "paid";

export interface Tx {
  readonly id: number;
  readonly kind: TxKind;
  /** The port the money moves from (`in`, into the core) or to (`out`); null for both seats at once. */
  readonly seat: Seat | null;
  readonly direction: "in" | "out";
  /** EGB moved. */
  readonly amount: number;
  readonly step: TxStep;
  /** Set from `in-block` on. */
  readonly block: number | null;
  /** null for a simulated transaction: the screen shows SIMULATED where the hash would be. */
  readonly hash: `0x${string}` | null;
  /** When it reached its current step (ms since the epoch). */
  readonly stepAt: number;
}

export type MatchPlay =
  | { readonly game: "quick-draw"; readonly state: QuickDrawState }
  | { readonly game: "stock-duel"; readonly state: StockDuelState };

export interface Match {
  readonly id: number;
  readonly game: PlayableGameId;
  /** EGB per seat. */
  readonly stake: number;
  /** The block the match opened in, and the block after which either seat may take its stake back. */
  readonly openedBlock: number;
  readonly refundBlock: number;
  readonly play: MatchPlay;
  /** Set when the game ends. `winner` null is a draw. */
  readonly outcome: { readonly winner: Seat | null } | null;
  /** Each seat has taken its stake back (Refund). */
  readonly refunded: readonly [boolean, boolean];
}

/** What a tap station's 128×64 OLED shows: a small top line, a big middle and a small bottom line. */
export interface StationView {
  readonly top: string;
  readonly big: string;
  readonly bottom: string;
}

export type Phase =
  | "boot" // the boot sequence
  | "attract" // TAP TO START
  | "home" // the library
  | "join" // both seats tap a badge
  | "stake" // pick a stake, both tap to sign
  | "playing" // a game runs
  | "result" // the winner is paid
  | "refund"; // the Box missed its settle: each seat takes its stake back

export interface BoxState {
  readonly phase: Phase;
  readonly games: readonly GameInfo[];
  readonly focus: GameId;
  readonly seats: readonly [SeatState, SeatState];
  readonly chain: ChainState;
  /** The stake chosen on the Stake screen, in EGB. */
  readonly stake: number;
  readonly match: Match | null;
  /** Transactions still on screen, newest last. */
  readonly txs: readonly Tx[];
  readonly stations: readonly [StationView, StationView];
}

export type Cue = "boot" | "tap" | "block" | "seal" | "flip" | "tick" | "win" | "lose" | "error";

/** The moment that changed the state, so the screen animates the moment rather than diffing states. */
export type BoxEvent =
  | { readonly type: "init" }
  | { readonly type: "phase"; readonly from: Phase; readonly to: Phase }
  | { readonly type: "focus"; readonly game: GameId }
  | { readonly type: "block"; readonly block: number }
  | { readonly type: "gas"; readonly gwei: number }
  /** A badge tapped a station. `accepted` false: the tap meant nothing here (the station buzzes no). */
  | { readonly type: "tap"; readonly seat: Seat; readonly accepted: boolean }
  | { readonly type: "seat"; readonly seat: Seat }
  | { readonly type: "stake"; readonly amount: number }
  | { readonly type: "tx"; readonly tx: Tx }
  | { readonly type: "game" }
  | { readonly type: "buzz"; readonly seat: Seat }
  | { readonly type: "cue"; readonly cue: Cue };

/** What a touch on the screen asks the Box for. */
export type ScreenCommand =
  | { readonly type: "booted" } // the boot sequence finished
  | { readonly type: "start" } // TAP TO START
  | { readonly type: "focus"; readonly game: GameId }
  | { readonly type: "play" } // Play on Home
  | { readonly type: "stake"; readonly amount: number }
  | { readonly type: "back" }
  | { readonly type: "rematch" }
  | { readonly type: "home" }
  /** Refund: once the stakes unlock, send every refund still owed (each goes to its own badge, whoever asks). */
  | { readonly type: "refund" };

export interface BoxLink {
  state(): BoxState;
  subscribe(listener: (state: BoxState, event: BoxEvent) => void): () => void;
  send(command: ScreenCommand): void;
}
