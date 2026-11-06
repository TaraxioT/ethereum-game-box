// The Box's core: the phase machine, composed from the catalogue, the chain port (USDC stakes, results, the lobby),
// transactions and station views, behind BoxLink. It has no DOM, no Node APIs and no clock of its own: everything comes through CorePorts,
// so SimLink runs it in the browser, the Box server on the Pi, and tests on a fake clock.
//
// Taps come in as TapEvents: a `touch`, then `done` or `fail`. A tap is judged at its touch time.
//   - Outside a game, a known badge whose tap needs no roll is acted on at its touch; anything else waits for `done`.
//   - In a game, the game hears the touch at once: Quick Draw takes a known seated badge's touch as its tap, and holds
//     an unknown chip's touch until its read says whose it is; Stock Duel freezes the card the player saw, plays it on
//     `done` with the chip's roll, and lets it go on `fail`.
//   - A built game's rules run outside the core (RulesRunnerPort, a sandboxed child on the Pi): its taps reach them
//     as finished taps judged at their touch time, a known badge's at its touch when the game needs no roll, and
//     anything the rules get wrong (over budget, a throw, a crash) voids the match and sends both stakes back.
//   - A store game has no rules here: the Box writes each finished tap in the match's log and tells the kiosk's frame,
//     and when the game ends the log goes to the verifier, whose split pays the pot.
//   - A tap that touched before the phase changed never reaches the new phase.
// Every finished match goes to the match log as a transcript. Stakes go on chain the moment both seats sign, and the
// match begins once they are confirmed in the pot: the transaction bar follows the pot, and the result goes when the
// match ends.
import type { Seat } from "@egb/sdk";
import { hash32, other, SEATS } from "@egb/sdk";
import type {
  ChainHead,
  CorePorts,
  JudgeWatch,
  ResultOrder,
  RulesSnapshot,
  StoreBundle,
  StoreChainPort,
  TapEvent,
  TapPlan,
  TapSource,
  TimerHandle,
  TxWatch,
} from "./ports.ts";
import type { LogEntry, TranscriptTap } from "@egb/sdk";
import type {
  Badge,
  Board,
  BoxEvent,
  BoxLink,
  BoxState,
  BuiltPlay,
  Cue,
  FrameWord,
  GameId,
  GameInfo,
  Judged,
  Lobby,
  Match,
  MatchPlay,
  Phase,
  PlayerCard,
  PlayerRecord,
  PlayFor,
  ScreenCommand,
  SeatState,
  StationView,
  StoreEnd,
  StorePlay,
  TapCard,
  TapMeaning,
  TeamGameId,
  Tx,
} from "./types.ts";
import { rules as quickDraw } from "../games/quick-draw/rules.ts";
import type { QuickDrawEvent } from "../games/quick-draw/types.ts";
import type { StockDuelEvent } from "../games/stock-duel/types.ts";
import { frontIndex, rules as stockDuel, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { defaultStake, DEFAULT_FOCUS, isTeamGame, stakeOf } from "./catalogue.ts";
import { transcriptOf } from "./transcript.ts";
import { createTxBook, type TxOrder } from "./txs.ts";
import { proposeLabel } from "./labels.ts";
import { stationViews, type StationInput } from "./stations.ts";
import { rematchOpen, tapPlan } from "./plan.ts";
import { createTimers } from "./timers.ts";
import { sameBadge } from "./badges.ts";
import { startBuilt, type BuiltDriver } from "./built.ts";
import { createStoreLog, type StoreLog } from "./store-log.ts";

/** Join waits this long with both seats full before moving on to Stake. */
export const JOIN_SETTLE_MS = 700;
/** Home falls back to attract after this long with no taps or touches. */
export const IDLE_MS = 60_000;
/**
 * The game builder goes back to Home after this long with no command from the screen. Its views send `build` as the
 * player works (and as a build streams in), so only a builder left alone times out; a running build carries on.
 */
export const BUILD_IDLE_MS = 5 * 60_000;
/** How often a running game is stepped. */
export const TICK_MS = 50;
/** A finished game stays on screen this long (the winner, the reaction times, the last seal) before it settles. */
export const END_HOLD_MS = 2_400;
/** Refund goes back to Home this long after both stakes are back. */
export const REFUND_DONE_MS = 2_000;
/** The lobby's top-up, in USDC (the relayer mints it). */
export const TOPUP_USDC = 100;
/** The game's title and championship are read again this often while Stake, the lobby or the result shows. */
export const BOARD_MS = 5_000;
/** Sepolia's pace, for the screen's block clock between heads. */
export const BLOCK_MS = 12_000;

/** Who plays Player 2: the bot (the demo) or a person at the second station. */
export type Opponent = "bot" | "hotseat";

export interface CoreOptions {
  /** The bot's badge. With the opponent `bot`, Player 2's seat is the bot's alone. Absent: always hot seat. */
  readonly bot?: Badge;
  /** This Box has the game builder (the Box server): Home's NEW GAME opens the `build` phase. The demo has none. */
  readonly builder?: boolean;
}

export interface Core extends BoxLink {
  /**
   * A tap: `touch`, then exactly one `done` or `fail`, sharing a tap id. Ids are per source: the taps library numbers
   * the stations' taps, and injected taps take theirs from `nextTap`.
   */
  tap(event: TapEvent, source?: TapSource): void;
  /** What the next tap at this seat should ask of the badge. */
  plan(seat: Seat): TapPlan;
  /** A fresh id for an injected tap (the test page, Demo mode's screen taps and bot). */
  nextTap(): number;
  opponent(): Opponent;
  setOpponent(opponent: Opponent): void;
  /** Off: the Box can't settle the match it is running, so it goes to Refund when the game ends. */
  power(): boolean;
  setPower(on: boolean): void;
  /**
   * Back to Home now (the test page). A pot that hasn't settled stays on chain until its refund opens (the server
   * refunds it then); a settlement already sent lands as it would have.
   */
  reset(): void;
  /** Stops every timer. */
  stop(): void;
}

/** How a tap went, for the station's buzz: one short buzz when it did something, two when it didn't. */
function tookTap(meaning: TapMeaning): boolean {
  return meaning !== "ignored" && meaning !== "refused" && meaning !== "let-go";
}

interface SeatSlot {
  badge: Badge | null;
  signed: boolean;
}

/** A tap between its touch and its done or fail. */
interface OpenTap {
  readonly seat: Seat;
  readonly at: number;
  readonly source: TapSource;
  /** The phase change count at the touch: a tap from before the last change is dropped. */
  readonly epoch: number;
  /** Already judged at its touch. */
  acted: boolean;
  /** The game heard its touch and waits for its done or fail. */
  held: boolean;
}

/**
 * What a tap brings to a game. `touch`: a chip landed on the seat's reader (whose isn't known yet). `tap`: the seated
 * badge's chip, touched at `at`, with its verified roll when the plan was `random`. `release`: the touch didn't count.
 */
type GameTap =
  | { readonly kind: "touch"; readonly seat: Seat; readonly at: number }
  | { readonly kind: "tap"; readonly seat: Seat; readonly at: number; readonly roll: number | null }
  | { readonly kind: "release"; readonly seat: Seat };

/** A team game's play: its rules run here, in the core. */
type TeamPlay = Exclude<MatchPlay, BuiltPlay | StorePlay>;

/** A store game's bundle, wanted from Play to the end of its match. */
interface WantedBundle {
  readonly id: GameId;
  readonly title: string;
  readonly hash: `0x${string}`;
  /** What its manifest says; null until it is here and checked. */
  facts: StoreBundle | null;
}

function startPlay(game: TeamGameId, seed: number, now: number): TeamPlay {
  return game === "quick-draw"
    ? { game, state: quickDraw.start(seed, now) }
    : { game, state: stockDuel.start(seed, now) };
}

function outcomeOf(play: TeamPlay): Match["outcome"] {
  return play.game === "quick-draw" ? quickDraw.outcome(play.state) : stockDuel.outcome(play.state);
}

/** Each seat's front card while it is still picking, or null. Changes are the Rolodex's drum steps. */
function fronts(play: MatchPlay, now: number): readonly [number | null, number | null] {
  if (play.game !== "stock-duel" || play.state.phase !== "pick") return [null, null];
  const duel = play.state;
  const shown = Math.max(duel.phaseAt, now - SHOW_LAG_MS);
  const front = (seat: Seat) => (duel.played[seat] === null ? frontIndex(duel, seat, shown) : null);
  return [front(0), front(1)];
}

interface Moment {
  readonly cue: Cue;
  readonly seat: Seat | null;
}

/** The moments a game step makes: the sign turning, a shot or a jump, a drum stepping, a card going down. */
function playCues(before: MatchPlay, after: MatchPlay, frontsBefore: readonly (number | null)[], now: number): Moment[] {
  const moments: Moment[] = [];
  const add = (cue: Cue, seat: Seat | null = null) => moments.push({ cue, seat });
  if (before.game === "quick-draw" && after.game === "quick-draw") {
    const [was, is] = [before.state, after.state];
    if (was.phase === "wait" && is.phase !== "wait" && is.reason !== "early") add("draw");
    if (was.phase !== "done" && is.phase === "done") {
      if (is.winner === null) add("tie");
      else if (is.reason === "early") add("false-start", other(is.winner));
      else add("shot", is.winner);
    }
    if (is.standoff > was.standoff) add("tie");
  }
  if (before.game === "stock-duel" && after.game === "stock-duel") {
    const frontsAfter = fronts(after, now);
    for (const seat of SEATS) {
      const was = frontsBefore[seat];
      const is = frontsAfter[seat];
      if (was !== null && was !== undefined && is !== null && is !== was && before.state.round === after.state.round) add("step", seat);
      if (before.state.played[seat] === null && after.state.played[seat] !== null) add("play", seat);
    }
    if (before.state.phase === "reveal" && after.state.phase === "pick") add("round");
  }
  return moments;
}

function quickDrawEvent(tap: GameTap | null, now: number): QuickDrawEvent {
  if (tap === null) return { type: "tick", now };
  if (tap.kind === "release") return { type: "release", seat: tap.seat, now };
  return { type: tap.kind, seat: tap.seat, at: tap.at, now };
}

/** A Stock Duel tap without its badge's roll can't play a card: it lets the held card go. */
function stockDuelEvent(tap: GameTap | null, now: number): StockDuelEvent {
  if (tap === null) return { type: "tick", now };
  if (tap.kind === "touch") return { type: "touch", seat: tap.seat, now: tap.at };
  if (tap.kind === "tap" && tap.roll !== null) return { type: "tap", seat: tap.seat, now: tap.at, roll: tap.roll };
  return { type: "release", seat: tap.seat };
}

/** One game step: a tick (tap null) or a tap's part. */
function nextPlay(play: TeamPlay, tap: GameTap | null, now: number): TeamPlay {
  if (play.game === "quick-draw") {
    const next = quickDraw.step(play.state, quickDrawEvent(tap, now));
    return next === play.state ? play : { game: "quick-draw", state: next };
  }
  const next = stockDuel.step(play.state, stockDuelEvent(tap, now));
  return next === play.state ? play : { game: "stock-duel", state: next };
}

const viewKey = (view: StationView): string => JSON.stringify(view);

export function createCore(ports: CorePorts, options: CoreOptions = {}): Core {
  const { clock } = ports;
  const bot = options.bot ?? null;
  const timers = createTimers(clock);
  const listeners = new Set<(state: BoxState, event: BoxEvent) => void>();
  const { chain: port } = ports;

  let phase: Phase = "boot";
  /** Bumped on every phase change: taps that touched before it are dropped. */
  let epoch = 0;
  let games: readonly GameInfo[] = ports.library.games();
  let focus: GameId = games.some((g) => g.id === DEFAULT_FOCUS) ? DEFAULT_FOCUS : (games[0]?.id ?? DEFAULT_FOCUS);
  const seats: [SeatSlot, SeatSlot] = [
    { badge: null, signed: false },
    { badge: null, signed: false },
  ];
  const focused = gameOf(focus);
  if (!focused) throw new Error("the library has no games");
  let stake = defaultStake(focused);
  let playFor: PlayFor = "usdc";
  /** Each on-chain game's title and championship, as last read, and when the last read began (Box ms). */
  let boards: Readonly<Record<GameId, Board>> = {};
  let boardsAt = Number.NEGATIVE_INFINITY;
  let boardTimer: TimerHandle | null = null;
  /** Each station's last tap by a known badge. */
  const lastTaps: [{ badge: Badge; at: number } | null, { badge: Badge; at: number } | null] = [null, null];
  let game: GameId | null = null;
  /** The running built game's rules, through the runner; null for a team game or none. */
  let built: BuiltDriver | null = null;
  /** The chosen store game's bundle: set exactly while a store game is on its way to the end of its match. */
  let wanted: WantedBundle | null = null;
  /** The running store match's log and its time limit, and the entries of the last one closed. */
  let storeLog: StoreLog | null = null;
  let storeTimer: TimerHandle | null = null;
  let storeEntries: readonly LogEntry[] = [];
  let match: Match | null = null;
  let matchCount = 0;
  /** Each badge's USDC and player name, as last read from chain (absent: not read yet). */
  const balances = new Map<string, number>();
  const names = new Map<string, string | null>();
  /** Each badge's record in the game it was last read for. */
  const records = new Map<string, PlayerRecord | null>();
  /** USDC on its way to each address: top-ups, payouts and refunds not yet paid. */
  const incoming = new Map<string, number>();
  let lobby: Lobby = { badge: null, card: null, proposal: null, from: "home" };
  /** How many labels the lobby has proposed to the badge on show. */
  let proposals = 0;
  let refunding = false;
  let opponent: Opponent = bot ? "bot" : "hotseat";
  let power = true;
  /** Open taps by source and id. */
  const open = new Map<string, OpenTap>();
  let tapCount = 0;
  /** The running match's seed, its game taps, and each seat's first station tap from Stake on (the evidence). */
  let seed = 0;
  let matchStartedAt = 0;
  let matchTaps: TranscriptTap[] = [];
  const seen: [number | null, number | null] = [null, null];

  /** Sepolia's head, as the port last reported it. */
  let head: ChainHead = { block: 0, at: clock.now(), gasGwei: 0 };

  let idleTimer: TimerHandle | null = null;
  let joinTimer: TimerHandle | null = null;
  let tickTimer: TimerHandle | null = null;
  let lastFronts: readonly [number | null, number | null] = [null, null];
  /** What each station was last sent. */
  const shown: [string, string] = ["", ""];

  const book = createTxBook(
    {
      step(tx) {
        emit({ type: "tx", tx });
      },
      // A `tx` event for a transaction no longer in `txs` tells the screen it left.
      drop(tx) {
        emit({ type: "tx", tx });
      },
    },
    clock,
  );

  function gameOf(id: GameId): GameInfo | undefined {
    return games.find((info) => info.id === id);
  }

  /** A seated badge's record, while it is the focused game's. */
  function recordFor(badge: Badge | null): PlayerRecord | null {
    const record = badge ? records.get(badge.address) : null;
    return record && record.game === focus ? record : null;
  }

  function seatState(seat: Seat): SeatState {
    const { badge, signed } = seats[seat];
    return {
      badge,
      signed,
      ens: badge ? (names.get(badge.address) ?? null) : null,
      balance: badge ? (balances.get(badge.address) ?? null) : null,
      pending: badge ? (incoming.get(badge.address) ?? 0) : 0,
      record: recordFor(badge),
    };
  }

  function tapCard(seat: Seat): TapCard | null {
    const last = lastTaps[seat];
    if (!last) return null;
    const { address } = last.badge;
    return { badge: last.badge, ens: names.get(address) ?? null, read: names.has(address), at: last.at };
  }

  function snapshot(): BoxState {
    const input: StationInput = {
      phase,
      games,
      focus,
      seats: [seatState(0), seatState(1)],
      chain: { block: head.block, blockAt: head.at, blockMs: BLOCK_MS, gasGwei: head.gasGwei },
      fetching: wanted !== null && wanted.facts === null,
      stake,
      playFor,
      board: currentBoard(),
      boards,
      taps: [tapCard(0), tapCard(1)],
      match,
      txs: book.list(),
      lobby,
    };
    return { ...input, stations: stationViews(input, clock.now()) };
  }

  let state = snapshot();

  /** Sends each station its view when it changed. */
  function showStations(): void {
    for (const seat of SEATS) {
      const view = state.stations[seat];
      const key = viewKey(view);
      if (key === shown[seat]) continue;
      shown[seat] = key;
      ports.stations.show(seat, view);
    }
  }

  function emit(event: BoxEvent): void {
    state = snapshot();
    showStations();
    for (const listener of [...listeners]) listener(state, event);
  }

  function cue(name: Cue, seat: Seat | null = null): void {
    emit({ type: "cue", cue: name, seat });
  }

  // ── Phases ────────────────────────────────────────────────────────────────────────────────────────────────────

  function nobodySigned(): boolean {
    return !seats[0].signed && !seats[1].signed;
  }

  /** No stake is committed: seats can change under the opponent switch. */
  function outsideMatch(): boolean {
    return phase === "boot" || phase === "attract" || phase === "home" || phase === "join" || (phase === "stake" && nobodySigned());
  }

  function resetIdle(): void {
    timers.cancel(idleTimer);
    if (phase === "home") idleTimer = timers.after(IDLE_MS, () => setPhase("attract"));
    else if (phase === "lobby") idleTimer = timers.after(IDLE_MS, () => setPhase("home"));
    else if (phase === "build") idleTimer = timers.after(BUILD_IDLE_MS, () => setPhase("home"));
    else idleTimer = null;
  }

  function setPhase(to: Phase): void {
    const from = phase;
    phase = to;
    epoch++;
    timers.cancel(joinTimer);
    joinTimer = null;
    if (to === "home" || to === "stake") {
      seats[0].signed = false;
      seats[1].signed = false;
    }
    if (to === "home" || to === "stake") match = null;
    if (to === "home") {
      fitSeatsToOpponent();
      // The built game's child goes with the game: Join starts it again.
      stopBuilt();
      if (game && gameOf(game)?.kind === "built") ports.rules?.stop();
      // A store game's bundle goes with the game too: nothing is kept between matches.
      stopStore();
      dropBundle();
      keepFocus();
    }
    if (to === "stake") {
      seen[0] = null;
      seen[1] = null;
      readSeats();
    }
    resetIdle();
    emit({ type: "phase", from, to });
    if (to === "join") maybeLeaveJoin();
    followBoard();
  }

  function bothSeated(): boolean {
    return seats[0].badge !== null && seats[1].badge !== null;
  }

  function maybeLeaveJoin(): void {
    if (phase !== "join" || !bothSeated() || joinTimer !== null || wanted?.facts === null) return;
    joinTimer = timers.after(JOIN_SETTLE_MS, () => {
      joinTimer = null;
      if (phase === "join" && bothSeated()) setPhase("stake");
    });
  }

  // ── Seats ─────────────────────────────────────────────────────────────────────────────────────────────────────

  function clearSeat(seat: Seat): void {
    seats[seat] = { badge: null, signed: false };
    emit({ type: "seat", seat });
  }

  /** The bot's badge sits only on Player 2's seat, and only while the bot plays; nobody else sits there then. */
  function fits(seat: Seat, badge: Badge): boolean {
    const isBot = sameBadge(badge, bot);
    return opponent === "bot" ? (seat === 1) === isBot : !isBot;
  }

  function fitSeatsToOpponent(): void {
    for (const seat of SEATS) {
      const badge = seats[seat].badge;
      if (badge && !fits(seat, badge)) clearSeat(seat);
    }
  }

  function owe(address: string, amount: number): void {
    incoming.set(address, (incoming.get(address) ?? 0) + amount);
  }

  function land(address: string, amount: number): void {
    const left = (incoming.get(address) ?? 0) - amount;
    if (left > 0) incoming.set(address, left);
    else incoming.delete(address);
  }

  /** A store game is in hand: its money is Store USDC, through this port, and not the Box's USDC. */
  function storeFocus(): StoreChainPort | undefined {
    return wanted || match?.play.game === "store" || gameOf(focus)?.kind === "store" ? port.store : undefined;
  }

  /** A badge's card, its balance in what the focused game stakes. */
  function cardOf(address: `0x${string}`): Promise<PlayerCard> {
    const store = storeFocus();
    const card = port.player(address, focus);
    return store ? Promise.all([card, store.balance(address)]).then(([read, balance]) => ({ ...read, balance })) : card;
  }

  /**
   * Reads a badge's balance, player name and record in the focused game from chain; the seats and the lobby show them
   * when they come back.
   */
  function read(badge: Badge): void {
    cardOf(badge.address).then(
      (card) => {
        balances.set(card.address, card.balance);
        names.set(card.address, card.name);
        records.set(card.address, card.record);
        if (sameBadge(lobby.badge, badge)) {
          lobby = { ...lobby, card, proposal: card.name ? null : (lobby.proposal ?? proposeLabel(badge, proposals, ports.random())) };
          emit({ type: "lobby" });
        }
        for (const seat of SEATS) if (sameBadge(seats[seat].badge, badge)) emit({ type: "seat", seat });
        if (lastTaps.some((last) => sameBadge(last?.badge ?? null, badge))) emit({ type: "name", address: badge.address });
      },
      // Unread for now: the seat shows no balance, and the next read tries again.
      () => {},
    );
  }

  function readSeats(): void {
    for (const seat of SEATS) {
      const badge = seats[seat].badge;
      if (badge) read(badge);
    }
  }

  /** Sends a transaction through the port, and puts it on screen. `ended` runs when it is paid or failed. */
  function send(order: TxOrder, run: (watch: TxWatch) => void, ended?: (tx: Tx) => void): void {
    const { watch } = book.submit(order, ended);
    run(watch);
  }

  function takeSeat(seat: Seat, badge: Badge): TapMeaning {
    if (sameBadge(seats[seat].badge, badge)) return "again";
    if (!fits(seat, badge)) return "ignored";
    if (sameBadge(seats[other(seat)].badge, badge)) clearSeat(other(seat));
    seats[seat] = { badge, signed: false };
    emit({ type: "seat", seat });
    read(badge);
    maybeLeaveJoin();
    return "join";
  }

  // ── Stake and open ────────────────────────────────────────────────────────────────────────────────────────────

  function addresses(): [`0x${string}`, `0x${string}`] {
    const [one, two] = seats;
    if (!one.badge || !two.badge) throw new Error("a match needs both seats");
    return [one.badge.address, two.badge.address];
  }

  /** The chosen game's stakes go on chain. */
  function staked(): boolean {
    return wanted !== null || (game !== null && port.onChain(game));
  }

  function sign(seat: Seat): TapMeaning {
    const mine = seats[seat];
    if (!mine.badge || mine.signed) return "ignored";
    // A badge that can't cover the stake (or whose balance isn't read yet), or that needs a player name to stake, is
    // sent to the lobby to top up or claim one.
    const balance = balances.get(mine.badge.address);
    const nameless = port.stakeNeedsName && !names.get(mine.badge.address);
    const short = balance === undefined || balance < stakeOf(playFor, stake);
    if (staked() && (short || nameless)) {
      openLobby(mine.badge, "stake");
      return "refused";
    }
    mine.signed = true;
    emit({ type: "seat", seat });
    if (!seats[0].signed || !seats[1].signed) return "sign";
    openMatch();
    return "open";
  }

  /**
   * Both seats signed. A game on chain first moves both stakes into the pot (a Box-signed `Stake`): the Box stays on
   * Stake, showing the open's progress, until it is confirmed on chain (a block past its own: the relayer's `done`,
   * `paid` here), and only then does the match begin; in a block alone isn't enough. An open that fails sends both
   * players back to sign again, with nothing staked. A store game's stakes go to `StorePot`, the same way. A game off
   * chain (a built game) begins at once.
   */
  function openMatch(): void {
    if (!game) throw new Error("no game was chosen");
    const chosen = game;
    const badges = addresses();
    const id = ++matchCount;
    if (!staked()) return beginMatch(id, chosen, badges, 0, 0);
    const round = port.nextRound();
    const amount = stakeOf(playFor, stake);
    const waiting = epoch;
    let begun = false;
    send(
      { kind: "open", seat: null, direction: "in", amount: amount * 2 },
      (watch) => {
        const hear: TxWatch = (update) => {
          watch(update);
          // Only the wait that sent it acts on it: a reset or a new phase since has moved on.
          if (begun || epoch !== waiting || phase !== "stake") return;
          if (update.step === "paid") {
            begun = true;
            beginMatch(id, chosen, badges, round, amount);
          } else if (update.step === "failed") {
            cue("error");
            setPhase("stake");
            leaveLostGame();
          }
        };
        if (wanted) port.store?.open({ round, bundle: wanted.hash, badges, amount }, hear);
        else port.open({ round, game: chosen, badges, amount }, hear);
      },
      () => {
        for (const badge of badges) refreshBalance(badge);
      },
    );
  }

  /** The match begins: its stakes (`amount` each, 0 off chain) are confirmed in the pot, or there are none. */
  function beginMatch(id: number, chosen: GameId, badges: [`0x${string}`, `0x${string}`], round: number, amount: number): void {
    const now = clock.now();
    // The seed takes fresh randomness, so nobody can work out the draw from the seats and the round.
    seed = hash32("match", id, badges[0], badges[1], round, ports.random());
    matchStartedAt = now;
    matchTaps = [];
    refunding = false;
    const opened = (play: MatchPlay): Match => ({
      id,
      game: chosen,
      playFor: port.onChain(chosen) ? playFor : "usdc",
      round,
      stake: amount,
      openedBlock: head.block,
      refundAt: now + port.refundAfterMs,
      play,
      outcome: null,
      voided: false,
      endedAt: null,
      refunded: [false, false],
      lines: null,
    });
    // What was staked plays, whatever the rack says now: a built game can take a store game's id while the stakes go in.
    if (wanted?.facts) return openStore(wanted, wanted.facts, now, opened);
    if (gameOf(chosen)?.kind === "built") return openBuilt(chosen, now, opened);
    const play = startPlay(chosen as TeamGameId, seed, now);
    match = opened(play);
    lastFronts = fronts(play, now);
    setPhase("playing");
    cue("round");
    tickTimer = timers.every(TICK_MS, () => stepGame(null));
    // The draw lands on its exact moment, not on the next tick, so reaction times are fair to the millisecond.
    if (play.game === "quick-draw") timers.after(Math.max(0, play.state.drawAt - now), () => stepGame(null));
  }

  /** Reads a badge's balance again, after money moved. */
  function refreshBalance(address: `0x${string}`): void {
    (storeFocus() ?? port).balance(address).then(
      (balance) => {
        balances.set(address, balance);
        for (const seat of SEATS) if (seats[seat].badge?.address === address) emit({ type: "seat", seat });
        if (lobby.badge?.address === address && lobby.card) {
          lobby = { ...lobby, card: { ...lobby.card, balance } };
          emit({ type: "lobby" });
        }
      },
      () => {},
    );
  }

  // ── Built games ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Starts a built game's rules. The match opens when their first state comes back (the child started at Join, so
   * that is a few ms); until then the Box stays on Stake. A start that fails voids the match before it plays.
   */
  function openBuilt(id: GameId, now: number, opened: (play: MatchPlay) => Match): void {
    const rules = ports.rules;
    const blank: BuiltPlay = { game: "built", id, state: null, stations: state.stations };
    const driver: BuiltDriver | null = rules
      ? startBuilt(rules, id, seed, now, {
          snapshot: (snap) => (match ? applyBuilt(snap) : beginBuilt(opened({ ...blank, state: snap.state, stations: snap.stations }), snap)),
          failed: () => voidBuilt(() => opened(blank)),
        })
      : null;
    built = driver;
    if (!driver) voidBuilt(() => opened(blank));
  }

  function beginBuilt(first: Match, snap: RulesSnapshot): void {
    if (phase !== "stake") return stopBuilt();
    match = first;
    setPhase("playing");
    cue("round");
    tickTimer = timers.every(TICK_MS, () => built?.tick(clock.now()));
    if (snap.outcome) endBuilt(snap.outcome);
  }

  function applyBuilt(snap: RulesSnapshot): void {
    if (!match || match.outcome || match.play.game !== "built") return;
    match = { ...match, play: { ...match.play, state: snap.state, stations: snap.stations } };
    emit({ type: "game" });
    if (snap.outcome) endBuilt(snap.outcome);
  }

  function endBuilt(outcome: NonNullable<Match["outcome"]>): void {
    if (!match) return;
    match = { ...match, outcome, endedAt: clock.now() };
    stopBuilt();
    emit({ type: "game" });
    timers.after(END_HOLD_MS, conclude);
  }

  /** The rules failed: the match is void, a draw nobody played, and both stakes go back at the settle. */
  function voidBuilt(blank: () => Match): void {
    const before = phase;
    if (before !== "stake" && before !== "playing") return;
    stopBuilt();
    match = { ...(match ?? blank()), outcome: { winner: null }, voided: true, endedAt: clock.now() };
    emit({ type: "game" });
    cue("error");
    // Voided before it began: straight to the result. Mid-game: the screen holds a moment first.
    if (before === "stake") conclude();
    else timers.after(END_HOLD_MS, conclude);
  }

  function stopBuilt(): void {
    built?.stop();
    built = null;
    timers.cancel(tickTimer);
    tickTimer = null;
  }

  // ── Store games ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Fetches a store game's bundle, afresh for every match. Join waits for it, so nothing can be staked before it is
   * here and checked. One that fails has sealed its game: the Box goes Home.
   */
  function fetchBundle(info: GameInfo): void {
    const { bundles } = ports;
    if (!bundles || !info.bundle) return;
    const mine: WantedBundle = { id: info.id, title: info.title, hash: info.bundle, facts: null };
    wanted = mine;
    bundles.fetch(mine.id, mine.hash).then(
      (facts) => {
        if (wanted !== mine) return;
        mine.facts = facts;
        emit({ type: "game" });
        maybeLeaveJoin();
      },
      () => {
        if (wanted !== mine) return;
        cue("error");
        setPhase("home");
      },
    );
  }

  function dropBundle(): void {
    if (!wanted) return;
    wanted = null;
    ports.bundles?.drop();
  }

  /** The focus stays on a game in the rack, unless a store game that left it is still under way. */
  function keepFocus(): void {
    if (!gameOf(focus) && !wanted && games[0]) focus = games[0].id;
  }

  /** A store game that left the rack (its index can't be reached) with nothing staked on it yet: back Home. */
  function leaveLostGame(): void {
    if (!wanted || gameOf(wanted.id)) return;
    const opening = seats[0].signed && seats[1].signed;
    if (phase === "join" || phase === "lobby" || (phase === "stake" && !opening)) setPhase("home");
  }

  /** The store game begins: its page takes the frame, the Box's log opens, and the manifest's time runs. */
  function openStore({ id, title, hash }: WantedBundle, facts: StoreBundle, now: number, opened: (play: MatchPlay) => Match): void {
    const limit = facts.minutes * 60_000;
    match = opened({ game: "store", id, title, bundle: hash, taps: facts.taps, endsAt: now + limit, lines: ["PLAY", "PLAY"], judged: null, resultAt: null });
    storeLog = createStoreLog();
    setPhase("playing");
    cue("round");
    storeTimer = timers.after(limit, () => closeStore("time"));
  }

  function stopStore(): void {
    storeLog = null;
    timers.cancel(storeTimer);
    storeTimer = null;
  }

  /** A word from the game's frame. Nothing it can say moves money: `end` only closes the match. */
  function frameWord(word: FrameWord): void {
    if (!match || match.outcome || match.play.game !== "store") return;
    if (word.t === "end") return closeStore(word.why);
    if (word.t === "event") return storeLog?.event(word.name, word.data, clock.now());
    const seat = SEATS.find((s) => s === word.seat);
    if (seat === undefined) return;
    if (word.t === "buzz") {
      ports.stations.buzz(seat, "ok");
      return emit({ type: "buzz", seat });
    }
    const lines: [string, string] = [match.play.lines[0], match.play.lines[1]];
    lines[seat] = word.text;
    match = { ...match, play: { ...match.play, lines } };
    emit({ type: "stations" });
  }

  /** The match is over: the log closes, and after the end hold it goes to the verifier. */
  function closeStore(why: StoreEnd): void {
    if (!storeLog || !match) return;
    const now = clock.now();
    storeEntries = storeLog.close(why, now);
    stopStore();
    match = { ...match, outcome: { winner: null }, endedAt: now };
    emit({ type: "game" });
    timers.after(END_HOLD_MS, conclude);
  }

  /** Sends the log to the verifier, and waits on JUDGING for what it says. */
  function sendToJudge(current: Match, play: StorePlay): void {
    const badges = addresses();
    const { id, round, stake: amount } = current;
    setPhase("judging");
    const money = settlement(badges, amount);
    port.store?.judge({ round, bundle: play.bundle, game: play.id, badges, amount, startedAt: matchStartedAt, entries: storeEntries }, (update) => {
      money(update);
      heardJudge(id, update);
    });
  }

  /** The verifier's transaction on screen, from its first word of money, and each balance read again when it lands. */
  function settlement(badges: readonly `0x${string}`[], amount: number): JudgeWatch {
    let watch: TxWatch | null = null;
    return (update) => {
      if (update.step === "judging" || (update.step === "failed" && !watch)) return;
      if (!watch) {
        const shares = update.payouts ?? badges.map(() => amount);
        badges.forEach((address, i) => owe(address, shares[i] ?? 0));
        const order = { kind: update.payouts ? "settle" : "refund", seat: null, direction: "out", amount: amount * badges.length } as const;
        ({ watch } = book.submit(order, () => {
          badges.forEach((address, i) => {
            land(address, shares[i] ?? 0);
            refreshBalance(address);
          });
        }));
      }
      const step = update.step === "paying" ? "sent" : update.step === "failed" ? "failed" : "paid";
      watch({ step, hash: update.hash, etherscan: update.etherscan, block: null, error: step === "failed" ? update.reason : null });
    };
  }

  /**
   * What the verifier says of the match on JUDGING. Paid or refunded, the Result shows it. Failed, or never answered,
   * nobody has paid the pot: Refund opens once its delay has run, as for a Box that missed its settle.
   */
  function heardJudge(id: number, update: Judged): void {
    if (phase !== "judging" || match?.id !== id || match.play.game !== "store") return;
    const over = update.step === "paid" || update.step === "refunded";
    match = { ...match, play: { ...match.play, judged: update, resultAt: over ? clock.now() : null } };
    if (update.step === "failed") {
      setPhase("refund");
      cue("error");
    } else if (over) {
      setPhase("result");
      cue("over");
    } else {
      emit({ type: "game" });
    }
  }

  // ── Playing ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Steps the game with a tick (tap null) or a tap. Returns whether the game changed. */
  function stepGame(tap: GameTap | null): boolean {
    if (!match || match.outcome || match.play.game === "built" || match.play.game === "store") return false;
    const now = clock.now();
    const before = match.play;
    const after = nextPlay(before, tap, now);
    const changed = after !== before;
    const outcome = changed ? outcomeOf(after) : null;
    if (changed) match = { ...match, play: after, outcome, endedAt: outcome ? now : null };
    const cues = playCues(before, after, lastFronts, now);
    lastFronts = fronts(after, now);
    if (changed) emit({ type: "game" });
    // The Rolodex turns with the clock, so the stations can change while the game state does not.
    else if (JSON.stringify(snapshot().stations) !== JSON.stringify(state.stations)) emit({ type: "stations" });
    for (const moment of cues) cue(moment.cue, moment.seat);
    if (outcome) {
      timers.cancel(tickTimer);
      tickTimer = null;
      timers.after(END_HOLD_MS, conclude);
    }
    return changed;
  }

  /** The finished match, to the match log: after the end hold, so a late tap the game turned away is in it too. */
  function record(winner: Seat | null, endedAt: number): void {
    if (!match) return;
    const [one, two] = addresses();
    ports.log.record(
      transcriptOf(
        {
          match: match.id,
          game: match.game,
          seed,
          badges: [one, two],
          stake: match.stake,
          startedAt: matchStartedAt,
          endedAt,
          taps: matchTaps,
          winner,
          // A store match pays a split, not a winner: its transcript never counts toward records.
          voided: match.voided || match.play.game === "store",
          seen: [seen[0], seen[1]],
        },
        ports.log,
      ),
    );
  }

  /**
   * After the end hold: report the result on chain if the Box has power (it settles the pot), else the Box has missed
   * its settle and Refund opens, once the pot's refund delay has run.
   */
  function conclude(): void {
    if (!match?.outcome) return;
    const { winner } = match.outcome;
    record(winner, match.endedAt ?? clock.now());
    // The frame's page has gone with the match, so its bundle does too.
    dropBundle();
    if (!power) {
      setPhase("refund");
      cue("error");
      return;
    }
    const current = match;
    if (current.play.game === "store") return sendToJudge(current, current.play);
    if (port.onChain(current.game) && !current.voided) {
      // The match began only once its pot was confirmed, so the result settles a pot that is there.
      settle(current, { round: current.round, game: current.game, badges: addresses(), winner });
    }
    setPhase("result");
    if (!current.voided) cue("over", winner);
  }

  /** Sends the result. Once it is paid, its lines are read from chain at its receipt, never made up here. */
  function settle(settled: Match, order: ResultOrder): void {
    const paid = settled.stake * 2;
    const payees: (readonly [`0x${string}`, number])[] =
      paid === 0 ? [] : order.winner === null ? order.badges.map((a) => [a, settled.stake] as const) : [[order.badges[order.winner], paid] as const];
    for (const [address, sum] of payees) owe(address, sum);
    send(
      { kind: "settle", seat: order.winner, direction: "out", amount: paid },
      (watch) => port.settle(order, watch),
      (tx) => {
        for (const [address, sum] of payees) land(address, sum);
        for (const address of order.badges) refreshBalance(address);
        if (tx.step !== "paid") return;
        port.outcome(order, tx.hash).then(
          (lines) => {
            if (match?.id !== settled.id) return;
            match = { ...match, lines };
            emit({ type: "game" });
          },
          () => {},
        );
      },
    );
  }

  // ── Refund ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Either seat's tap, once the pot's refund delay has run, sends the pot back to both. */
  function claimRefund(): TapMeaning {
    if (!match || match.refunded[0] || refunding || clock.now() < match.refundAt) return "ignored";
    const { id, round, stake: amount } = match;
    const store = match.play.game === "store";
    const pot = store ? port.store : port;
    if (!pot || (!store && !port.onChain(match.game)) || amount === 0) {
      match = { ...match, refunded: [true, true] };
      timers.after(REFUND_DONE_MS, () => phase === "refund" && match?.id === id && setPhase("home"));
      return "refund";
    }
    const badges = addresses();
    refunding = true;
    for (const address of badges) owe(address, amount);
    send(
      { kind: "refund", seat: null, direction: "out", amount: amount * 2 },
      (watch) => pot.refund(round, watch),
      (tx) => {
        refunding = false;
        for (const address of badges) {
          land(address, amount);
          refreshBalance(address);
        }
        if (tx.step !== "paid" || match?.id !== id) return;
        match = { ...match, refunded: [true, true] };
        emit({ type: "game" });
        timers.after(REFUND_DONE_MS, () => phase === "refund" && match?.id === id && setPhase("home"));
      },
    );
    return "refund";
  }

  // ── The lobby ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** Opens the lobby (Home's LOBBY, or a Stake tap that can't cover the stake), showing `badge` if one tapped. */
  function openLobby(badge: Badge | null, from: Lobby["from"]): void {
    lobby = { badge: null, card: null, proposal: null, from };
    setPhase("lobby");
    if (badge) showInLobby(badge);
  }

  /** A badge tapped a station in the lobby: its card, read from chain. */
  function showInLobby(badge: Badge): TapMeaning {
    resetIdle();
    if (!sameBadge(lobby.badge, badge)) {
      proposals = 0;
      lobby = { ...lobby, badge, card: null, proposal: null };
      emit({ type: "lobby" });
    }
    read(badge);
    return "card";
  }

  // ── The boards: each game's title and championship ─────────────────────────────────────────────────────────

  /**
   * The game the board is about: on Stake and the result the chosen game, if it is on chain; in the lobby the focused
   * game, or Stock Duel's for a game that isn't.
   */
  function boardGame(): GameId | null {
    if (phase === "lobby") return port.onChain(focus) ? focus : DEFAULT_FOCUS;
    return game !== null && port.onChain(game) ? game : null;
  }

  function currentBoard(): Board | null {
    const about = boardGame();
    return about === null ? null : (boards[about] ?? null);
  }

  /** The game's championship is open for scoring now. */
  function cupOpen(): boolean {
    const cup = currentBoard()?.cup;
    return cup != null && cup.ends > clock.now();
  }

  /** Reads the boards while Stake, the lobby or the result shows, and every `BOARD_MS` after; stops on any other. */
  function followBoard(): void {
    timers.cancel(boardTimer);
    boardTimer = null;
    if (phase !== "stake" && phase !== "lobby" && phase !== "result") return;
    readBoards();
    boardTimer = timers.every(BOARD_MS, readBoards);
  }

  /** A badge tapped: its titles and championships show with its name, so boards older than `BOARD_MS` are read again. */
  function freshenBoards(): void {
    if (clock.now() - boardsAt >= BOARD_MS) readBoards();
  }

  /** Every on-chain game's title and championship, read together; a game whose read fails keeps its last board. */
  function readBoards(): void {
    boardsAt = clock.now();
    const onChain = games.filter((g) => g.kind === "team" && port.onChain(g.id)).map((g) => g.id);
    void Promise.allSettled(onChain.map((id) => port.board(id).then((read) => [id, read] as const))).then((results) => {
      const next = { ...boards };
      for (const result of results) if (result.status === "fulfilled") next[result.value[0]] = result.value[1];
      boards = next;
      // A championship that closed while it was chosen falls back to the title, before anyone signs.
      if (playFor === "cup" && !cupOpen() && phase === "stake" && nobodySigned()) {
        playFor = "title";
        emit({ type: "play-for", target: playFor });
      }
      emit({ type: "board" });
    });
  }

  function topUp(): void {
    const badge = lobby.badge;
    if (!badge) return;
    owe(badge.address, TOPUP_USDC);
    send(
      { kind: "topup", seat: null, direction: "out", amount: TOPUP_USDC },
      (watch) => (storeFocus() ?? port).topup(badge.address, watch),
      () => {
        land(badge.address, TOPUP_USDC);
        refreshBalance(badge.address);
      },
    );
  }

  function claimName(): void {
    const { badge, proposal, card } = lobby;
    if (!badge || !proposal || card?.name) return;
    send(
      { kind: "claim", seat: null, direction: "out", amount: 0 },
      (watch) => port.claim(proposal, badge.address, watch),
      () => read(badge),
    );
  }

  function proposeAnother(): void {
    const { badge, card } = lobby;
    if (!badge || card?.name) return;
    proposals++;
    lobby = { ...lobby, proposal: proposeLabel(badge, proposals, ports.random()) };
    emit({ type: "lobby" });
  }

  // ── Taps ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A seated badge's tap on the result, once the result has been seen: the same as the screen's Rematch. */
  function rematchTap(seat: Seat, badge: Badge): TapMeaning {
    if (!sameBadge(seats[seat].badge, badge) || !rematchOpen(match, clock.now())) return "ignored";
    command({ type: "rematch" });
    return "rematch";
  }

  function handleTap(seat: Seat, badge: Badge, at: number, roll: number | null): TapMeaning {
    const seatedHere = sameBadge(seats[seat].badge, badge);
    // Whoever taps is named on screen: their ENS name, read now if the Box doesn't know it yet.
    lastTaps[seat] = { badge, at: clock.now() };
    if (!names.has(badge.address)) read(badge);
    freshenBoards();
    switch (phase) {
      case "boot":
      case "build":
      case "judging":
        return "ignored";
      case "result":
        return rematchTap(seat, badge);
      case "attract":
        setPhase("home");
        return "wake";
      case "home":
      case "join":
        resetIdle();
        return takeSeat(seat, badge);
      case "stake":
        return seatedHere ? sign(seat) : "ignored";
      case "playing":
        return seatedHere ? gameTap({ kind: "tap", seat, at, roll }) : "ignored";
      case "refund":
        return seatedHere ? claimRefund() : "ignored";
      case "lobby":
        return showInLobby(badge);
    }
  }

  /** A tap's end in the game: the transcript keeps it, with its touch time and roll. */
  function gameTap(tap: Extract<GameTap, { kind: "tap" }>): TapMeaning {
    if (match?.play.game === "store") {
      // The log keeps it for the judge, and the game's page hears it.
      const log = storeLog;
      matchTaps.push({ seat: tap.seat, at: tap.at, roll: tap.roll, accepted: log !== null });
      if (!log) return "ignored";
      log.tap(tap.seat, tap.at, tap.roll);
      emit({ type: "game-tap", seat: tap.seat, at: tap.at, roll: tap.roll });
      if (log.full()) closeStore("time");
      return "play";
    }
    if (match?.play.game === "built") {
      // The rules judge it; the Box has handed it on at its touch time.
      const accepted = built !== null && match.outcome === null;
      built?.tap(tap.seat, tap.at, tap.roll);
      matchTaps.push({ seat: tap.seat, at: tap.at, roll: tap.roll, accepted });
      return accepted ? "play" : "ignored";
    }
    const accepted = stepGame(tap);
    // The Stock Duel tap that played nothing still holds its card: let it go.
    const letGo = !accepted && release(tap.seat);
    matchTaps.push({ seat: tap.seat, at: tap.at, roll: tap.roll, accepted });
    return accepted ? "play" : letGo ? "let-go" : "ignored";
  }

  /** Lets go of the card a seat's touch held. Whether there was one. */
  function release(seat: Seat): boolean {
    return stepGame({ kind: "release", seat });
  }

  /** Tells the screen and the station how a tap went: one short buzz when it did something, two when it didn't. */
  function report(seat: Seat, meaning: TapMeaning): void {
    const accepted = tookTap(meaning);
    ports.stations.buzz(seat, accepted ? "ok" : "no");
    emit({ type: "tap", seat, accepted, meaning });
    emit({ type: "buzz", seat });
  }

  /** A station tap by a seated badge from Stake to the end of the match: evidence the players were at the Box. */
  function note(entry: OpenTap, badge: Badge): void {
    if (entry.source !== "station" || (phase !== "stake" && phase !== "playing")) return;
    if (sameBadge(seats[entry.seat].badge, badge)) seen[entry.seat] ??= entry.at;
  }

  function judge(entry: OpenTap, badge: Badge, roll: number | null): void {
    note(entry, badge);
    report(entry.seat, handleTap(entry.seat, badge, entry.at, roll));
  }

  /** The running game hears this touch now: it is a seated badge's, or a chip not read yet. */
  function inGame(seat: Seat, badge: Badge | null): boolean {
    const seated = seats[seat].badge;
    return phase === "playing" && match !== null && match.outcome === null && seated !== null && (badge === null || sameBadge(badge, seated));
  }

  function touch(event: Extract<TapEvent, { phase: "touch" }>, source: TapSource): void {
    const entry: OpenTap = { seat: event.seat, at: event.at, source, epoch, acted: false, held: false };
    open.set(`${source}:${event.tap}`, entry);
    if (inGame(event.seat, event.badge) && (match?.play.game === "built" || match?.play.game === "store")) {
      // A built or store game hears finished taps: a known badge's now, at its touch, when the game needs no roll;
      // anything else when the chip has answered (its `done`), still judged at the touch.
      if (event.badge && tapPlan(state, event.seat, clock.now()) !== "random") {
        entry.acted = true;
        judge(entry, event.badge, null);
      }
      return;
    }
    if (inGame(event.seat, event.badge)) {
      // Quick Draw judges a known seated badge by its touch; anything else the game holds until the chip is read.
      if (match?.play.game === "quick-draw" && event.badge) {
        entry.acted = true;
        return judge(entry, event.badge, null);
      }
      entry.held = true;
      stepGame({ kind: "touch", seat: event.seat, at: event.at });
      return;
    }
    // Judged by its touch: a known badge whose tap needs no roll is acted on now, not when the chip answers.
    if (event.badge && tapPlan(state, event.seat, clock.now()) !== "random") {
      entry.acted = true;
      judge(entry, event.badge, null);
    }
  }

  function tap(event: TapEvent, source: TapSource = "station"): void {
    if (event.phase === "touch") {
      touch(event, source);
      // A touch judged at once has told the screen already; any other is still being read, and the screen hears it land.
      if (open.get(`${source}:${event.tap}`)?.acted === false) emit({ type: "touch", seat: event.seat });
      return;
    }
    const key = `${source}:${event.tap}`;
    const entry = open.get(key);
    open.delete(key);
    if (!entry || entry.acted) return;
    // A tap that began before the phase changed (a stake tap whose chip answered after the match opened) would land
    // in a phase it was never meant for.
    if (entry.epoch !== epoch) return report(entry.seat, "ignored");
    if (event.phase === "fail") return report(entry.seat, entry.held && release(entry.seat) ? "let-go" : "ignored");
    // Not the seated player's chip after all.
    if (entry.held && !sameBadge(seats[entry.seat].badge, event.badge)) return report(entry.seat, release(entry.seat) ? "let-go" : "ignored");
    judge(entry, event.badge, event.roll);
  }

  // ── Screen commands ───────────────────────────────────────────────────────────────────────────────────────────

  function command(cmd: ScreenCommand): void {
    resetIdle();
    switch (cmd.type) {
      case "booted":
        if (phase === "boot") setPhase("attract");
        return;
      case "start":
        if (phase === "attract") setPhase("home");
        return;
      case "focus":
        if (phase !== "home" || cmd.game === focus || !gameOf(cmd.game)) return;
        focus = cmd.game;
        emit({ type: "focus", game: focus });
        // The seats show their record in the focused game.
        readSeats();
        return;
      case "play": {
        const info = gameOf(focus);
        if (phase !== "home" || !info?.ready) return;
        if (info.kind === "built" ? !ports.rules : info.kind === "store" ? !ports.bundles || !port.store : !isTeamGame(info.id)) return;
        game = info.id;
        // A built game's child starts now, at Join, so its first step pays no start-up cost.
        if (info.kind === "built") ports.rules?.prepare(info.id);
        if (info.kind === "store") fetchBundle(info);
        // Every game starts at its default stake, played for USDC.
        if (stake !== defaultStake(info) || playFor !== "usdc") {
          stake = defaultStake(info);
          playFor = "usdc";
          emit({ type: "stake", amount: stake });
        }
        setPhase(bothSeated() && !wanted ? "stake" : "join");
        return;
      }
      case "stake":
        if (phase !== "stake" || !nobodySigned() || (cmd.amount === stake && playFor === "usdc")) return;
        if (!game || !gameOf(game)?.stakes.includes(cmd.amount)) return;
        stake = cmd.amount;
        playFor = "usdc";
        emit({ type: "stake", amount: stake });
        return;
      case "play-for":
        if (phase !== "stake" || !nobodySigned() || cmd.target === playFor) return;
        if (!game || !port.onChain(game) || (cmd.target === "cup" && !cupOpen())) return;
        playFor = cmd.target;
        emit({ type: "play-for", target: playFor });
        return;
      case "back":
        if (phase === "lobby") setPhase(lobby.from === "stake" && bothSeated() && game ? "stake" : "home");
        else if (phase === "join" || phase === "build" || (phase === "stake" && nobodySigned())) setPhase("home");
        return;
      case "rematch": {
        if (phase !== "result") return;
        fitSeatsToOpponent();
        const info = game === null ? undefined : gameOf(game);
        if (info?.kind === "built") ports.rules?.prepare(info.id);
        if (match?.play.game !== "store") return setPhase(bothSeated() ? "stake" : "join");
        // A store game is fetched again for every match, if it is still in the rack and can play.
        if (!info?.ready) return setPhase("home");
        focus = info.id;
        fetchBundle(info);
        return setPhase("join");
      }
      case "home":
        // From Refund too: a pot left unrefunded is refunded by the server once its delay has run. From Judging too: a
        // verdict pays the pot with nobody watching.
        if (phase === "result" || phase === "build" || phase === "refund" || phase === "lobby" || phase === "judging") setPhase("home");
        return;
      case "build":
        // From Home, the builder opens; inside it, resetIdle() above was the point (a player is still there).
        if (phase === "home" && options.builder) setPhase("build");
        return;
      case "refund":
        if (phase === "refund") claimRefund();
        return;
      case "lobby":
        if (phase === "home" || phase === "attract") openLobby(null, "home");
        return;
      case "topup":
        if (phase === "lobby") topUp();
        return;
      case "propose":
        if (phase === "lobby") proposeAnother();
        return;
      case "claim":
        if (phase === "lobby") claimName();
        return;
      case "frame":
        if (phase === "playing") frameWord(cmd.word);
        return;
    }
  }

  // ── The clock ─────────────────────────────────────────────────────────────────────────────────────────────────

  const unwatchHead = port.watchHead((next) => {
    if (next.block <= head.block) return;
    const gasMoved = next.gasGwei !== head.gasGwei;
    head = next;
    emit({ type: "block", block: next.block });
    if (gasMoved) emit({ type: "gas", gwei: next.gasGwei });
  });

  const unwatchLibrary = ports.library.subscribe(() => {
    games = ports.library.games();
    keepFocus();
    emit({ type: "games" });
    leaveLostGame();
  });

  showStations();

  return {
    state: () => state,
    now: () => clock.now(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send: command,
    tap,
    plan: (seat) => tapPlan(state, seat, clock.now()),
    nextTap: () => ++tapCount,
    opponent: () => opponent,
    setOpponent(next) {
      if (next === opponent || (next === "bot" && !bot)) return;
      opponent = next;
      if (outsideMatch()) {
        fitSeatsToOpponent();
        if (phase === "stake" && !bothSeated()) setPhase("join");
      }
    },
    power: () => power,
    setPower(on) {
      power = on;
    },
    reset() {
      stopBuilt();
      // A pot that never settles stays on chain until its refund opens; the server refunds it then.
      setPhase("home");
    },
    stop() {
      stopBuilt();
      ports.rules?.stop();
      dropBundle();
      timers.clear();
      book.stop();
      unwatchLibrary();
      unwatchHead();
    },
  };
}
