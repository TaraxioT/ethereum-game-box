// The core's ports: everything the phase machine needs from the world. The core has no DOM and no Node APIs and reads
// no global clock; a host (SimLink in the browser, the Box server on the Pi) hands it these.
import type { Seat, StationView, Transcript, BuiltEvent, LogEntry, Outcome, TapNeed } from "@egb/sdk";
import type { Badge, Board, GameId, GameInfo, Judged, PlayerCard, TxStep } from "./types.ts";

/** An opaque timer handle. */
export type TimerHandle = { readonly __timer: true };

export interface Clock {
  /** ms since the epoch. */
  now(): number;
  after(ms: number, run: () => void): TimerHandle;
  every(ms: number, run: () => void): TimerHandle;
  cancel(handle: TimerHandle | null): void;
}

/** The tap stations, by seat. */
export interface StationsPort {
  /** What the seat's station shows now. Hosts send it on change, on relink and every 5 s. */
  show(seat: Seat, view: StationView): void;
  /** `ok`: one short buzz (an accepted tap). `no`: two short (a refused one). */
  buzz(seat: Seat, kind: "ok" | "no"): void;
}

/** What the next tap at a seat should ask of the badge. `none`: the tap means nothing now (still identified). */
export type TapPlan = TapNeed | "none";

export type TapErrorCode = "lifted" | "radio" | "not-halo" | "refused" | "verify" | "link";

/**
 * One physical tap at a seat: a `touch` (the chip landed), then exactly one `done` or `fail`. All three share `tap`.
 * `at` is when the chip touched the reader, on the host's clock, for all three.
 */
export type TapEvent =
  | {
      readonly phase: "touch";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      /** Known from the roster by UID, or null for a chip this Box hasn't read yet. */
      readonly badge: Badge | null;
    }
  | {
      readonly phase: "done";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      readonly badge: Badge;
      /** The badge's verified roll (uint32) when the plan was `random`, else null. */
      readonly roll: number | null;
    }
  | {
      readonly phase: "fail";
      readonly tap: number;
      readonly seat: Seat;
      readonly at: number;
      readonly badge: Badge | null;
      readonly error: { readonly code: TapErrorCode; readonly text: string };
    };

/** A relayed transaction's progress, as the relayer reports it (`GET /tx/:id`). */
export interface ChainTxUpdate {
  readonly step: Exclude<TxStep, "signed">;
  readonly hash: `0x${string}` | null;
  readonly etherscan: string | null;
  readonly block: number | null;
  readonly error: string | null;
}

/** Hears a transaction's every step, up to `paid` or `failed`. */
export type TxWatch = (update: ChainTxUpdate) => void;

/** Both stakes of a match, for the pot. The game is the core's id; the port names it on chain. */
export interface StakeOrder {
  readonly round: number;
  readonly game: GameId;
  readonly badges: readonly [`0x${string}`, `0x${string}`];
  /** Whole USDC per seat. */
  readonly amount: number;
}

/** A finished match, for `BoxResults`: the same round as its stakes. `winner` is the seat, or null for a draw. */
export interface ResultOrder {
  readonly round: number;
  readonly game: GameId;
  readonly badges: readonly [`0x${string}`, `0x${string}`];
  readonly winner: 0 | 1 | null;
}

/** A store match's stakes, for `StorePot`: the bundle's hash names the game. */
export interface StoreStakeOrder {
  readonly round: number;
  readonly bundle: `0x${string}`;
  readonly badges: readonly `0x${string}`[];
  /** Whole USDC per seat. */
  readonly amount: number;
}

/** A closed store match, for the verifier: what the port needs to write the log's header, and its entries. */
export interface JudgeOrder extends StoreStakeOrder {
  readonly game: GameId;
  /** ms since the epoch, the Box's clock. */
  readonly startedAt: number;
  readonly entries: readonly LogEntry[];
}

/** Hears the verifier's every new word, up to `paid`, `refunded` or `failed`. */
export type JudgeWatch = (update: Judged) => void;

/**
 * The money and the judge behind a store game. `StorePot` and Store USDC are apart from `DuelPot` and its USDC. Sends
 * never wait, as on `ChainPort`.
 */
export interface StoreChainPort {
  /** A badge's Store USDC. */
  balance(address: `0x${string}`): Promise<number>;
  /** Sends every stake into the pot (a Box-signed `Stake` naming the bundle). */
  open(order: StoreStakeOrder, watch: TxWatch): void;
  /** Sends the pot back past its refund delay, when the verifier never paid it. */
  refund(round: number, watch: TxWatch): void;
  /** 100 Store USDC to a badge. */
  topup(address: `0x${string}`, watch: TxWatch): void;
  /** Sends the match's log, signed by the Box's key, to the verifier, and follows it to a payout or a refund. */
  judge(order: JudgeOrder, watch: JudgeWatch): void;
}

/** Sepolia's head: its number, when it was sealed (ms since the epoch) and its base fee (gwei). */
export interface ChainHead {
  readonly block: number;
  readonly at: number;
  readonly gasGwei: number;
}

/**
 * The chain behind the stakes and the lobby: USDC balances, the pot, results, top-ups and player names. On the Box it
 * is Sepolia through the relayer, every request signed by the Box's P-256 key (`src/chain/`); the demo runs it in
 * memory (`demo-chain.ts`). Sends never wait: each step comes back through its watch. Reads reject when the chain
 * can't be read.
 */
export interface ChainPort {
  /** Whether a game's stakes and results go on chain. A game that doesn't (a built game) plays for nothing. */
  onChain(game: GameId): boolean;
  /** The next round for this Box: kept on disk, so it never repeats, even across restarts. */
  nextRound(): number;
  /** How long after its open an unsettled pot may be refunded (ms). */
  readonly refundAfterMs: number;
  /** Only a badge with a player name may stake (`DuelPot` refuses `NotAPlayer`): one without is sent to the lobby. */
  readonly stakeNeedsName: boolean;
  balance(address: `0x${string}`): Promise<number>;
  /** A badge's name, balance and record in `game`. */
  player(address: `0x${string}`, game: GameId): Promise<PlayerCard>;
  board(game: GameId): Promise<Board>;
  /** Sends both stakes into the pot (a Box-signed `Stake`). */
  open(order: StakeOrder, watch: TxWatch): void;
  /** Sends the result (a Box-signed `Result`), which settles the pot. */
  settle(order: ResultOrder, watch: TxWatch): void;
  /** Sends an unsettled pot back to both badges. */
  refund(round: number, watch: TxWatch): void;
  /** 100 USDC to a badge. */
  topup(address: `0x${string}`, watch: TxWatch): void;
  /** `<label>.gamebox.eth` for a badge (a Box-signed `Seat`). */
  claim(label: string, address: `0x${string}`, watch: TxWatch): void;
  /**
   * What a settled result did, read from chain at its receipt: the payout, the title, the championship. `hash` is the
   * result's transaction (null on a chain with no hashes: the demo's).
   */
  outcome(order: ResultOrder, hash: `0x${string}` | null): Promise<readonly string[]>;
  /** Calls back with each new head; returns the unsubscribe. */
  watchHead(listener: (head: ChainHead) => void): () => void;
  /** Absent: no store game can run (the demo, or Sepolia before `StorePot` is deployed). */
  readonly store?: StoreChainPort;
}

/** What the core needs from a store game's manifest, once its bundle is here and checked. */
export interface StoreBundle {
  /** The match's time limit, in minutes. */
  readonly minutes: number;
  readonly taps: TapNeed;
}

/**
 * Store games' bundles, one at a time: fetched for each match, and never kept. A bundle's code never runs here: it runs
 * only in the kiosk's sandboxed frame.
 */
export interface BundlePort {
  /** Fetches the bundle and checks it. A rejection means the game is sealed, and nothing may be staked on it. */
  fetch(game: GameId, hash: `0x${string}`): Promise<StoreBundle>;
  /** Forgets the bundle: stops a fetch still running, and deletes what is on disk. */
  drop(): void;
}

/** The games the Box can run: the team games, the installed built games and the store's games. */
export interface LibraryPort {
  games(): readonly GameInfo[];
  /** Calls back when a game is installed or removed. */
  subscribe(listener: () => void): () => void;
}

/** A built game's rules, after a start or a step. */
export interface RulesSnapshot {
  readonly state: unknown;
  readonly outcome: Outcome | null;
  readonly stations: readonly [StationView, StationView];
}

/**
 * A built game's rules, run outside the core (a sandboxed child process on the Pi). One game at a time. A rejected
 * promise (over budget, crashed, stopped) voids the match: both stakes go back.
 */
export interface RulesRunnerPort {
  /** Starts the game's process (at Join), so the first step pays no start-up cost. */
  prepare(game: string): void;
  start(game: string, seed: number, now: number): Promise<RulesSnapshot>;
  step(event: BuiltEvent): Promise<RulesSnapshot>;
  /** Stops the process; a pending call rejects. */
  stop(): void;
}

/** Where finished matches go: the session log on the Pi, nowhere in the demo. */
export interface MatchLog {
  record(transcript: Transcript): void;
  /** How many counted results this pair of badges (either seat) has had since `since` (ms since the epoch). */
  countedSince(badges: readonly [string, string], since: number): number;
}

/**
 * Where a tap came from. Only a station's tap is one the Box saw: injected taps (the test page) and Demo mode's
 * screen play like any other, but they are not evidence for a counted result.
 */
export type TapSource = "station" | "injected";

export interface CorePorts {
  readonly clock: Clock;
  readonly stations: StationsPort;
  readonly chain: ChainPort;
  readonly library: LibraryPort;
  /** Absent: built games can't run (the demo). */
  readonly rules?: RulesRunnerPort;
  /** Absent: store games can't run (the demo, a Box with no store settings). */
  readonly bundles?: BundlePort;
  readonly log: MatchLog;
  /** uint32 randomness for seeds and the lobby's proposed labels (never a game's outcome on a real Box: badges roll those). */
  readonly random: () => number;
}
