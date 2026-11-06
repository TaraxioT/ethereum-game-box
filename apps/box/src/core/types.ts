// The one interface between the screen and the Box. The screen reads `BoxState`, hears `BoxEvent`s and sends
// `ScreenCommand`s; whatever runs the Box (SimLink in the demo, LiveLink to the Box server) sits behind `BoxLink`.
import type { DuelSeat, GameManifest, Seat, Seated, StationView, TapNeed } from "@egb/sdk";
import type { QuickDrawState } from "../games/quick-draw/types.ts";
import type { StockDuelState } from "../games/stock-duel/types.ts";

export type { DuelSeat, Seat, StationView };

/** A game's id: lower-case words joined by `-` (a team game's, or a built game's folder). */
export type GameId = string;
/** The games whose rules run in the core. */
export type TeamGameId = "quick-draw" | "stock-duel";

export interface GameInfo {
  readonly id: GameId;
  /**
   * `team`: shipped with the Box. `built`: made by the game builder, its rules in a sandboxed child process. `store`: a
   * bundle from the store, downloaded for each match, played in the kiosk's frame and judged by the verifier.
   */
  readonly kind: "team" | "built" | "store";
  readonly title: string;
  /** The most it seats on this Box: two, or up to four for a store game. */
  readonly players: number;
  /** The fewest it can start with, when that's under `players`: a store game's manifest says. */
  readonly minPlayers?: number;
  /** A typical match, in minutes; 0 for a store game, whose time limit is in its bundle. */
  readonly minutes: number;
  /** The stakes the Box offers, in whole USDC. A game that isn't on chain (a built game) plays them for nothing. */
  readonly stakes: readonly number[];
  /** Who says what a result means: the Box, the chain, or the verifier's AI judge. */
  readonly tier: "refereed" | "verified" | "judged";
  /** false: sealed on Home with a SOON plate; Play stays dark. */
  readonly ready: boolean;
  /** Why a game that should play can't (a built game whose bundle failed), shown when it is focused; null otherwise. */
  readonly sealed: string | null;
  /** A built game's cartridge art (its icon.svg, served by the Box), or a store game's fallback. null: a team game's art
   * is the cartridge's own. */
  readonly icon: string | null;
  /** Its game.json as the Box checked it: what a built game's taps ask of the badge, what its frame is told. null for a
   * catalogue game with no folder, for a game.json that failed its check, and for a store game. */
  readonly manifest: GameManifest | null;
  /** A store game's identity: the sha256 of its zip, as `0x` hex. */
  readonly bundle?: `0x${string}`;
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
  /** The badge's record in the focused game, read from chain; null until read, or for a game not on chain. */
  readonly record: PlayerRecord | null;
}

/** A badge's wins, losses and draws in one game, as `PlayerStats` holds them. */
export interface PlayerRecord {
  readonly game: GameId;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
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

/** `topup`: 100 USDC from the lobby. `claim`: a player name. `open`: every stake into the pot. `settle`: the result,
 * which pays the pot. `refund`: an unsettled pot back to every player. */
export type TxKind = "topup" | "claim" | "open" | "settle" | "refund";
/** The relayer's steps: signed by the Box, sent, mined, then confirmed (`paid`), or `failed` at any point. */
export type TxStep = "signed" | "sent" | "in-block" | "paid" | "failed";

export interface Tx {
  readonly id: number;
  readonly kind: TxKind;
  /** The port the money moves from (`in`, into the core) or to (`out`); null for every player at once. */
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

/** Why a store match closed, as its log says: the game called `end()`, its time ran out, or its frame was lost. */
export type StoreEnd = "game" | "time" | "lost";

/** What the verifier has said of a store match, as far as it has gone. */
export interface Judged {
  readonly step: "judging" | "paying" | "paid" | "refunded" | "failed";
  /** Each player's payout in USDC, in seat order, once a verdict stands. */
  readonly payouts: readonly number[] | null;
  /** The settling transaction, once sent, and its Etherscan page. */
  readonly hash: `0x${string}` | null;
  readonly etherscan: string | null;
  /** Why it refunded or failed. */
  readonly reason: string | null;
}

/** A store game's match: its page in the kiosk's frame, the Box's log of it, and in time the verifier's split. */
export interface StorePlay {
  readonly game: "store";
  readonly id: GameId;
  readonly title: string;
  /** The bundle's sha256, as `0x` hex: the frame loads the page by it, and the pot and the log name it. */
  readonly bundle: `0x${string}`;
  /** What a tap asks of the badge: the bundle's manifest says. */
  readonly taps: TapNeed;
  /** When the manifest's time runs out (ms since the epoch). */
  readonly endsAt: number;
  /** Each player's station's big line, as the game last set it. */
  readonly lines: readonly string[];
  /** null until the verifier first answers. */
  readonly judged: Judged | null;
  /** When Result opened, the verifier's word having ended Judging (ms since the epoch); null before. */
  readonly resultAt: number | null;
}

export type MatchPlay =
  | { readonly game: "quick-draw"; readonly state: QuickDrawState }
  | { readonly game: "stock-duel"; readonly state: StockDuelState }
  | BuiltPlay
  | StorePlay;

/**
 * What a match is played for. `usdc`: each stakes `BoxState.stake`. `title` and `cup`: each stakes the mode's own amount
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
  /** Set when the game ends. `winner` null is a draw, and any store match: the verifier pays a split, not a winner. */
  readonly outcome: { readonly winner: DuelSeat | null } | null;
  /** The built game's rules failed (over budget, crashed): the match is void and both stakes go back. */
  readonly voided: boolean;
  /** When the game ended (ms since the epoch), or null while it runs. */
  readonly endedAt: number | null;
  /** Each player has taken their stake back (Refund). */
  readonly refunded: readonly boolean[];
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
  /** Its record in the game it was read for, or null for a game not on chain. */
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

/** A game's title and its open championship, read through the Universal Resolver. */
export interface Board {
  /** `champion.<game>.gamebox.eth`: its holder's name and streak, or null while nobody holds it. */
  readonly title: { readonly name: string; readonly holder: string; readonly streak: number } | null;
  /** The open championship (`mumbai-cup.<game>.gamebox.eth`), or null when none is open. */
  readonly cup: {
    readonly name: string;
    /** When scoring stops (ms since the epoch). */
    readonly ends: number;
    /** USDC. */
    readonly prize: number;
    readonly standings: readonly Standing[];
  } | null;
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
  | "join" // each seat taps a badge
  | "stake" // pick what to play for (USDC, the title, the championship), everyone taps to sign
  | "playing" // a game runs
  | "judging" // a store match's log is with the verifier
  | "result" // the winner is paid
  | "refund" // the Box missed its settle: each player takes their stake back
  | "lobby" // a badge's name, balance and top-up; the game's title and championship
  | "build"; // the game builder: the Designer and the Build screen (the Box's own screen only, never the demo)

export interface BoxState {
  readonly phase: Phase;
  readonly games: readonly GameInfo[];
  readonly focus: GameId;
  /**
   * The seats on show, each at its `Seat`: two, or as many as a chosen store game seats, from Play until the Box goes Home.
   * A store match's players are the ones with a badge (`playerSeats`): a seat left empty sits it out.
   */
  readonly seats: Seated<SeatState>;
  /** How many must sit down before the chosen game can start: every seat on show, unless a store game takes fewer. */
  readonly fewest: number;
  readonly chain: ChainState;
  /** A store game's bundle is on its way: nothing can be staked until it is here and checked. */
  readonly fetching: boolean;
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
  readonly taps: Seated<TapCard | null>;
  readonly match: Match | null;
  /** Transactions still on screen, newest last. */
  readonly txs: readonly Tx[];
  readonly lobby: Lobby;
  /** What each tap station's OLED shows (`@egb/sdk`'s model: tag, big, small and the tap overrides), a station a seat. */
  readonly stations: Seated<StationView>;
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
  /** A store game hears a tap: `seat` is the player's place, as its log and page count them, `at` when the chip touched the reader, `roll` its verified roll on `random` taps. */
  | { readonly type: "game-tap"; readonly seat: number; readonly at: number; readonly roll: number | null }
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

/**
 * What a store game's page said, once the kiosk's gate let it through, or that the page was lost. The kiosk passes it to
 * the core, which writes the log. `seat` is a player's place, and the page can name any: the core drops one it hasn't.
 */
export type FrameWord =
  | { readonly t: "event"; readonly name: string; readonly data: unknown }
  | { readonly t: "station"; readonly seat: number; readonly text: string }
  | { readonly t: "buzz"; readonly seat: number }
  | { readonly t: "end"; readonly why: Exclude<StoreEnd, "time"> };

/** What a touch on the screen asks the Box for. */
export type ScreenCommand =
  | { readonly type: "booted" } // the boot sequence finished
  | { readonly type: "start" } // TAP TO START
  | { readonly type: "focus"; readonly game: GameId }
  | { readonly type: "play" } // Play on Home
  /** Join's START: a store game goes on to Stake with the players it has, once enough have sat down. */
  | { readonly type: "begin" }
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
  /** The lobby: another label to claim, or claim the one proposed. */
  | { readonly type: "propose" }
  | { readonly type: "claim" }
  /** A store game's frame spoke. */
  | { readonly type: "frame"; readonly word: FrameWord };

export interface BoxLink {
  state(): BoxState;
  /** The Box's clock (ms since the epoch). Views time their animations by it, never by the screen's own clock. */
  now(): number;
  subscribe(listener: (state: BoxState, event: BoxEvent) => void): () => void;
  send(command: ScreenCommand): void;
}
