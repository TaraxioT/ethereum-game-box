// The one interface between the screen and the Box. The screen reads `BoxState`, hears `BoxEvent`s and sends
// `ScreenCommand`s; whatever runs the Box (SimLink in the demo, LiveLink to the Box server) sits behind `BoxLink`.
import type { GameManifest, Seat, StationView } from "@egb/sdk";
import type { QuickDrawState } from "../games/quick-draw/types.ts";
import type { StockDuelState } from "../games/stock-duel/types.ts";

export type { Seat, StationView };

/** A game's id: lower-case words joined by `-` (a team game's, or a built game's folder). */
export type GameId = string;
/** The games whose rules run in the core. */
export type TeamGameId = "quick-draw" | "stock-duel";

export interface GameInfo {
  readonly id: GameId;
  /** `team`: shipped with the Box. `built`: made by the game builder, its rules in a sandboxed child process. */
  readonly kind: "team" | "built";
  readonly title: string;
  readonly players: number;
  /** A typical match, in minutes. */
  readonly minutes: number;
  /** The stakes the Box offers, in whole USDC. A game that isn't on chain (a built game) plays them for nothing. */
  readonly stakes: readonly number[];
  readonly tier: "refereed" | "verified";
  /** false: sealed on Home with a SOON plate; Play stays dark. */
  readonly ready: boolean;
  /** Why a game that should play can't (a built game whose bundle failed), shown when it is focused; null otherwise. */
  readonly sealed: string | null;
  /** A built game's cartridge art (its icon.svg, served by the Box). null: a team game's art is the cartridge's own. */
  readonly icon: string | null;
  /** Its game.json as the Box checked it: what a built game's taps ask of the badge, what its frame is told. null for a
   * catalogue game with no folder, and for a game.json that failed its check. */
  readonly manifest: GameManifest | null;
}

export interface Badge {
  readonly address: `0x${string}`;
  /** Its name under gamebox.eth, e.g. `nova.gamebox.eth`. */
  readonly name: string;
}

export interface SeatState {
  readonly badge: Badge | null;
  /** The badge's player name on chain (`nova.gamebox.eth`), or null: none, or not read yet. */
  readonly ens: string | null;
  /** USDC, read from chain; null until the first read comes back. */
  readonly balance: number | null;
  /** USDC on its way to this badge: a top-up, payout or refund not yet done. */
  readonly pending: number;
  /** This seat has signed the entry for the match being staked. */
  readonly signed: boolean;
  /** The badge's stats over every game, from its name's `stats` record; null until read, or with no name or no stats. */
  readonly record: PlayerRecord | null;
}

/** A player's stats over every game, as `PlayerStats` writes them to its name's `stats` record. `streak` is its run of
 *  wins up to now, in any game (a loss or a draw ends it); `best` is the longest. */
export interface PlayerRecord {
  readonly played: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly streak: number;
  readonly best: number;
}

/** A row of `gamebox.eth`'s `leaderboard`: a player by name, and its stats. */
export interface Leader extends PlayerRecord {
  readonly name: string;
}

/** Sepolia's head, as the Box last read it (block 0 before the first read). */
export interface ChainState {
  readonly block: number;
  /** When `block` was sealed (ms since the epoch). */
  readonly blockAt: number;
  /** Milliseconds between blocks. */
  readonly blockMs: number;
  readonly gasGwei: number;
}

/** `topup`: 100 USDC from the lobby. `claim`: a player name. `open`: both stakes into the pot. `settle`: the result,
 * which pays the pot. `refund`: an unsettled pot back to both. */
export type TxKind = "topup" | "claim" | "open" | "settle" | "refund";
/** The relayer's steps: signed by the Box, sent, mined, then confirmed (`paid`), or `failed` at any point. */
export type TxStep = "signed" | "sent" | "in-block" | "paid" | "failed";

export interface Tx {
  readonly id: number;
  readonly kind: TxKind;
  /** The port the money moves from (`in`, into the core) or to (`out`); null for both seats at once. */
  readonly seat: Seat | null;
  readonly direction: "in" | "out";
  /** USDC moved (0 for a claim, or a result whose pot never opened). */
  readonly amount: number;
  readonly step: TxStep;
  /** Set from `in-block` on. */
  readonly block: number | null;
  /** The transaction's hash once the relayer has sent it, and its Etherscan page. */
  readonly hash: `0x${string}` | null;
  readonly etherscan: string | null;
  /** Why it failed, when it did. */
  readonly error: string | null;
  /** When it reached its current step (ms since the epoch). */
  readonly stepAt: number;
}

/** A built game's match as its rules child last returned it: its state (the frame draws it) and its stations. */
export interface BuiltPlay {
  readonly game: "built";
  readonly id: GameId;
  readonly state: unknown;
  readonly stations: readonly [StationView, StationView];
}

export type MatchPlay =
  | { readonly game: "quick-draw"; readonly state: QuickDrawState }
  | { readonly game: "stock-duel"; readonly state: StockDuelState }
  | BuiltPlay;

/**
 * What a match is played for. `usdc`: both stake `BoxState.stake`. `title` and `cup`: both stake the mode's own amount
 * (`MODE_STAKES`), the title or the open championship named as what is on the line. The winner takes the pot either
 * way, and every result on chain takes the title and scores the open championship, whatever it was played for.
 */
export type PlayFor = "usdc" | "title" | "cup";

export interface Match {
  readonly id: number;
  readonly game: GameId;
  readonly playFor: PlayFor;
  /** The Box's round: the `Stake` and the `Result` of this match carry it. */
  readonly round: number;
  /** USDC per seat; 0 for a game that isn't on chain. */
  readonly stake: number;
  /** The head when the match opened, and when its pot may be refunded (ms since the epoch). */
  readonly openedBlock: number;
  readonly refundAt: number;
  readonly play: MatchPlay;
  /** Set when the game ends. `winner` null is a draw. */
  readonly outcome: { readonly winner: Seat | null } | null;
  /** The built game's rules failed (over budget, crashed): the match is void and both stakes go back. */
  readonly voided: boolean;
  /** When the game ended (ms since the epoch), or null while it runs. */
  readonly endedAt: number | null;
  /** Each seat has taken its stake back (Refund). */
  readonly refunded: readonly [boolean, boolean];
  /** What the result did, read from chain after its receipt ("+20 USDC", the title, the championship); null before. */
  readonly lines: readonly string[] | null;
}

/** The badge a station read last, and its ENS name: the screen names whoever taps, wherever they tap. */
export interface TapCard {
  readonly badge: Badge;
  /** Its player name on chain (`nova.gamebox.eth`), or null: none, or not read yet. */
  readonly ens: string | null;
  /** Whether its name has been read from chain (false: `ens` null means not read yet). */
  readonly read: boolean;
  /** When it tapped (Box ms). */
  readonly at: number;
}

/** A badge's card in the lobby, read from chain. */
export interface PlayerCard {
  readonly address: `0x${string}`;
  /** Its player name (`nova.gamebox.eth`), or null: it has none yet. */
  readonly name: string | null;
  /** USDC. */
  readonly balance: number;
  /** Its stats over every game, from its name's `stats` record, or null: no name, or no stats yet. */
  readonly record: PlayerRecord | null;
}

/** One row of a championship's standings. */
export interface Standing {
  readonly name: string;
  readonly points: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
}

/** A game's title and its open cup, and the leaderboard over every game, read through the Universal Resolver. */
export interface Board {
  /** `champion.<game>.gamebox.eth`: its holder's name and streak, or null while nobody holds it. */
  readonly title: { readonly name: string; readonly holder: string; readonly streak: number } | null;
  /** The open cup (`mumbai-cup.<game>.gamebox.eth`), or null when none is open. */
  readonly cup: {
    readonly name: string;
    /** When scoring stops (ms since the epoch). */
    readonly ends: number;
    /** USDC. */
    readonly prize: number;
    readonly standings: readonly Standing[];
  } | null;
  /** `gamebox.eth`'s `leaderboard`: the top players over every game, in rank order (most wins, then who reached them
   *  first). */
  readonly leaders: readonly Leader[];
}

/** The lobby: whoever tapped last, their card and a label to claim. */
export interface Lobby {
  readonly badge: Badge | null;
  /** null while it is read. */
  readonly card: PlayerCard | null;
  /** A label the badge may claim, when it has no name. */
  readonly proposal: string | null;
  /** Where Back goes: Home, or the Stake screen a short balance came from. */
  readonly from: "home" | "stake";
}

export type Phase =
  | "boot" // the boot sequence
  | "attract" // TAP TO START
  | "home" // the library
  | "join" // both seats tap a badge
  | "stake" // pick what to play for (USDC, the title, the championship), both tap to sign
  | "playing" // a game runs
  | "result" // the winner is paid
  | "refund" // the Box missed its settle: each seat takes its stake back
  | "lobby" // a badge's name, balance and top-up; the game's title and championship
  | "build"; // the game builder: the Designer and the Build screen (the Box's own screen only, never the demo)

export interface BoxState {
  readonly phase: Phase;
  readonly games: readonly GameInfo[];
  readonly focus: GameId;
  readonly seats: readonly [SeatState, SeatState];
  readonly chain: ChainState;
  /** The stake chosen on the Stake screen, in USDC: what a `usdc` match puts in. */
  readonly stake: number;
  /** What the next match is played for (Stake's choice): USDC, the title or the championship. */
  readonly playFor: PlayFor;
  /**
   * The chosen (else focused) game's title and open championship, read from chain on Stake, the lobby and the result
   * and again every few seconds while one shows; null before the first read, or for a game that isn't on chain.
   */
  readonly board: Board | null;
  /** Every on-chain game's title and championship, by game, as last read (on those screens and on each badge's tap):
   *  what a badge holds shows with its name. */
  readonly boards: Readonly<Record<GameId, Board>>;
  /** Each station's last tap by a known badge, with its ENS name. */
  readonly taps: readonly [TapCard | null, TapCard | null];
  readonly match: Match | null;
  /** Transactions still on screen, newest last. */
  readonly txs: readonly Tx[];
  readonly lobby: Lobby;
  /** What each tap station's OLED shows (`@egb/sdk`'s model: tag, big, small and the tap overrides). */
  readonly stations: readonly [StationView, StationView];
}

/**
 * A moment in a match or in the Box's work that the screen marks (with a sound, a flash). The core says what happened;
 * how it sounds is the screen's. `seat` on the event says whose moment it is, where it is someone's. Moments a game's
 * screen times to its own animation (Stock Duel's dial, reveal and scored round) are the screen's, not cues.
 */
export type Cue =
  | "round" // a match opens, a new Stock Duel round begins
  | "draw" // Quick Draw: the sign turns to DRAW
  | "shot" // Quick Draw: a good draw (the winner's seat)
  | "false-start" // Quick Draw: a tap before the draw (the seat that jumped)
  | "tie" // Quick Draw: a dead heat, or nobody drew and the standoff is stood again
  | "step" // Stock Duel: a seat's spotlight steps to its next card
  | "play" // Stock Duel: a seat's card goes down (its tap, or played for it when time ran out)
  | "over" // the match is over (the winner's seat, or none for a draw)
  | "error"; // trouble: the stakes couldn't lock, a built game's rules failed, the Box missed its settle

/** What a badge's tap did, so the screen can tell it apart by ear. */
export type TapMeaning =
  | "wake" // woke the Box: attract to Home
  | "join" // took a seat
  | "again" // tapped the seat it already holds
  | "sign" // signed the stake
  | "open" // the second signature: the stakes lock and the match opens
  | "play" // a game took it (the game's own moment follows as a cue)
  | "let-go" // a game tap that played nothing: the card its touch held goes
  | "rematch" // asked for a rematch on the result
  | "refund" // claimed the refund
  | "card" // in the lobby: shows the badge's card
  | "refused" // the badge can't cover the stake (it is sent to the lobby)
  | "ignored"; // read, but it meant nothing here

/** The moment that changed the state, so the screen animates the moment rather than diffing states. */
export type BoxEvent =
  | { readonly type: "init" }
  | { readonly type: "phase"; readonly from: Phase; readonly to: Phase }
  | { readonly type: "focus"; readonly game: GameId }
  | { readonly type: "block"; readonly block: number }
  | { readonly type: "gas"; readonly gwei: number }
  /** A chip landed on a station's reader and is still being read: its tap (or nothing, if the read fails) follows. */
  | { readonly type: "touch"; readonly seat: Seat }
  /** A badge tapped a station. `accepted` false: the tap meant nothing here (the station buzzes no). */
  | { readonly type: "tap"; readonly seat: Seat; readonly accepted: boolean; readonly meaning: TapMeaning }
  | { readonly type: "seat"; readonly seat: Seat }
  | { readonly type: "stake"; readonly amount: number }
  | { readonly type: "tx"; readonly tx: Tx }
  | { readonly type: "game" }
  /** Only the stations' views moved, with the clock (Stock Duel's Rolodex turning): nothing on the screen animates. */
  | { readonly type: "stations" }
  /** The library changed: a game was installed or removed. */
  | { readonly type: "games" }
  /** The lobby's badge, card or proposal changed. */
  | { readonly type: "lobby" }
  /** A tapped badge's ENS name was read. */
  | { readonly type: "name"; readonly address: `0x${string}` }
  /** The game's title or championship was read again. */
  | { readonly type: "board" }
  /** What the next match is played for changed. */
  | { readonly type: "play-for"; readonly target: PlayFor }
  | { readonly type: "buzz"; readonly seat: Seat }
  | { readonly type: "cue"; readonly cue: Cue; readonly seat: Seat | null };

/** What a touch on the screen asks the Box for. */
export type ScreenCommand =
  | { readonly type: "booted" } // the boot sequence finished
  | { readonly type: "start" } // TAP TO START
  | { readonly type: "focus"; readonly game: GameId }
  | { readonly type: "play" } // Play on Home
  /** A USDC stake: the match is played for USDC. */
  | { readonly type: "stake"; readonly amount: number }
  /** Play for the title or the open championship, at the mode's own stake. */
  | { readonly type: "play-for"; readonly target: Exclude<PlayFor, "usdc"> }
  | { readonly type: "back" }
  | { readonly type: "rematch" }
  | { readonly type: "home" }
  /** Refund: once the stakes unlock, send every refund still owed (each goes to its own badge, whoever asks). */
  | { readonly type: "refund" }
  /** Home's NEW GAME cartridge: opens the game builder. Sent again while building, it says a player is still there. */
  | { readonly type: "build" }
  /** Home's LOBBY: a badge's name, balance and top-up. */
  | { readonly type: "lobby" }
  /** The lobby's Top up 100 USDC, for the badge on show. */
  | { readonly type: "topup" }
  /** The lobby: another label to claim, or claim one: the label typed on the screen, else the one proposed. */
  | { readonly type: "propose" }
  | { readonly type: "claim"; readonly label?: string };

export interface BoxLink {
  state(): BoxState;
  /** The Box's clock (ms since the epoch). Views time their animations by it, never by the screen's own clock. */
  now(): number;
  subscribe(listener: (state: BoxState, event: BoxEvent) => void): () => void;
  send(command: ScreenCommand): void;
}
