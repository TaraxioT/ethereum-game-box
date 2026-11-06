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
//   - A tap that touched before the phase changed never reaches the new phase.
// Every finished match goes to the match log as a transcript. Stakes go on chain the moment both seats sign, and the
// match opens at once: the transaction bar follows the pot, and the result waits only for the pot to land.
import type { Seat } from "@egb/sdk";
import { hash32, other, SEATS } from "@egb/sdk";
import type { ChainHead, CorePorts, ResultOrder, RulesSnapshot, TapEvent, TapPlan, TapSource, TimerHandle, TxWatch } from "./ports.ts";
import type { TranscriptTap } from "@egb/sdk";
import type {
  Badge,
  BoxEvent,
  BoxLink,
  BoxState,
  BuiltPlay,
  Cue,
  GameId,
  GameInfo,
  Lobby,
  Match,
  MatchPlay,
  Phase,
  PlayerRecord,
  ScreenCommand,
  SeatState,
  StationView,
  TapMeaning,
  TeamGameId,
  Tx,
} from "./types.ts";
import { rules as quickDraw } from "../games/quick-draw/rules.ts";
import type { QuickDrawEvent } from "../games/quick-draw/types.ts";
import type { StockDuelEvent } from "../games/stock-duel/types.ts";
import { frontIndex, rules as stockDuel, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { defaultStake, DEFAULT_FOCUS, isTeamGame } from "./catalogue.ts";
import { transcriptOf } from "./transcript.ts";
import { createTxBook, type TxOrder } from "./txs.ts";
import { proposeLabel } from "./labels.ts";
import { stationViews, type StationInput } from "./stations.ts";
import { REMATCH_TAP_MS, tapPlan } from "./plan.ts";
import { createTimers } from "./timers.ts";
import { sameBadge } from "./badges.ts";
import { startBuilt, type BuiltDriver } from "./built.ts";

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
type TeamPlay = Exclude<MatchPlay, BuiltPlay>;

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
  let game: GameId | null = null;
  /** The running built game's rules, through the runner; null for a team game or none. */
  let built: BuiltDriver | null = null;
  let match: Match | null = null;
  let matchCount = 0;
  /** Each badge's USDC and player name, as last read from chain (absent: not read yet). */
  const balances = new Map<string, number>();
  const names = new Map<string, string | null>();
  /** Each badge's record in the game it was last read for. */
  const records = new Map<string, PlayerRecord | null>();
  /** USDC on its way to each address: top-ups, payouts and refunds not yet paid. */
  const incoming = new Map<string, number>();
  let lobby: Lobby = { badge: null, card: null, proposal: null, board: null, from: "home" };
  /** How many labels the lobby has proposed to the badge on show. */
  let proposals = 0;
  /**
   * Each on-chain match's pot, by match id: on its way, open on chain, or never opened (the open failed), and the
   * result held until it lands. Kept per match, so a result decided before its pot landed is still sent after a
   * rematch or a reset.
   */
  const pots = new Map<number, { state: "pending" | "open" | "none"; then: (() => void) | null }>();
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

  function snapshot(): BoxState {
    const input: StationInput = {
      phase,
      games,
      focus,
      seats: [seatState(0), seatState(1)],
      chain: { block: head.block, blockAt: head.at, blockMs: BLOCK_MS, gasGwei: head.gasGwei },
      stake,
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
    }
    if (to === "stake") {
      seen[0] = null;
      seen[1] = null;
      readSeats();
    }
    resetIdle();
    emit({ type: "phase", from, to });
    if (to === "join") maybeLeaveJoin();
  }

  function bothSeated(): boolean {
    return seats[0].badge !== null && seats[1].badge !== null;
  }

  function maybeLeaveJoin(): void {
    if (phase !== "join" || !bothSeated() || joinTimer !== null) return;
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

  /**
   * Reads a badge's balance, player name and record in the focused game from chain; the seats and the lobby show them
   * when they come back.
   */
  function read(badge: Badge): void {
    port.player(badge.address, focus).then(
      (card) => {
        balances.set(card.address, card.balance);
        names.set(card.address, card.name);
        records.set(card.address, card.record);
        if (sameBadge(lobby.badge, badge)) {
          lobby = { ...lobby, card, proposal: card.name ? null : (lobby.proposal ?? proposeLabel(badge, proposals, ports.random())) };
          emit({ type: "lobby" });
        }
        for (const seat of SEATS) if (sameBadge(seats[seat].badge, badge)) emit({ type: "seat", seat });
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
    return game !== null && port.onChain(game);
  }

  function sign(seat: Seat): TapMeaning {
    const mine = seats[seat];
    if (!mine.badge || mine.signed) return "ignored";
    // A badge that can't cover the stake (or whose balance isn't read yet), or that needs a player name to stake, is
    // sent to the lobby to top up or claim one.
    const balance = balances.get(mine.badge.address);
    const nameless = port.stakeNeedsName && !names.get(mine.badge.address);
    if (staked() && (balance === undefined || balance < stake || nameless)) {
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
   * Stake, showing the open's progress, until it is in a block, and then the match begins. An open that fails sends
   * both players back to sign again, with nothing staked. A game off chain (a built game) begins at once.
   */
  function openMatch(): void {
    if (!game) throw new Error("no game was chosen");
    const chosen = game;
    const badges = addresses();
    const id = ++matchCount;
    if (!port.onChain(chosen)) return beginMatch(id, chosen, badges, 0, 0);
    const round = port.nextRound();
    const amount = stake;
    const waiting = epoch;
    let begun = false;
    const pot: { state: "pending" | "open" | "none"; then: (() => void) | null } = { state: "pending", then: null };
    pots.set(id, pot);
    send(
      { kind: "open", seat: null, direction: "in", amount: amount * 2 },
      (watch) =>
        port.open({ round, game: chosen, badges, amount }, (update) => {
          watch(update);
          // Only the wait that sent it acts on it: a reset or a new phase since has moved on.
          if (begun || epoch !== waiting || phase !== "stake") return;
          if (update.step === "in-block" || update.step === "paid") {
            begun = true;
            beginMatch(id, chosen, badges, round, amount);
          } else if (update.step === "failed") {
            pots.delete(id);
            cue("error");
            setPhase("stake");
          }
        }),
      (tx) => {
        pot.state = tx.step === "paid" ? "open" : "none";
        for (const badge of badges) refreshBalance(badge);
        const settleNow = pot.then;
        pot.then = null;
        settleNow?.();
      },
    );
  }

  /** The match begins: its stakes (`amount` each, 0 off chain) are in the pot's block, or there are none. */
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
    port.balance(address).then(
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

  // ── Playing ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Steps the game with a tick (tap null) or a tap. Returns whether the game changed. */
  function stepGame(tap: GameTap | null): boolean {
    if (!match || match.outcome || match.play.game === "built") return false;
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
          voided: match.voided,
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
    if (!power) {
      pots.delete(match.id);
      setPhase("refund");
      cue("error");
      return;
    }
    const current = match;
    if (port.onChain(current.game) && !current.voided) {
      const order: ResultOrder = { round: current.round, game: current.game, badges: addresses(), winner };
      // The result goes once the pot has landed, so it settles the pot it belongs to.
      const pot = pots.get(current.id);
      if (pot?.state === "pending") pot.then = () => settle(current, order);
      else settle(current, order);
    }
    setPhase("result");
    if (!current.voided) cue("over", winner);
  }

  /** Sends the result. Once it is paid, its lines are read from chain at its receipt, never made up here. */
  function settle(settled: Match, order: ResultOrder): void {
    const paid = pots.get(settled.id)?.state === "open" ? settled.stake * 2 : 0;
    pots.delete(settled.id);
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
    if (!port.onChain(match.game) || amount === 0) {
      match = { ...match, refunded: [true, true] };
      timers.after(REFUND_DONE_MS, () => phase === "refund" && match?.id === id && setPhase("home"));
      return "refund";
    }
    const badges = addresses();
    refunding = true;
    for (const address of badges) owe(address, amount);
    send(
      { kind: "refund", seat: null, direction: "out", amount: amount * 2 },
      (watch) => port.refund(round, watch),
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
    lobby = { badge: null, card: null, proposal: null, board: null, from };
    setPhase("lobby");
    readBoard();
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

  /** The title and the championship of the game the lobby is about: the focused game, if it is on chain. */
  function readBoard(): void {
    const about = port.onChain(focus) ? focus : DEFAULT_FOCUS;
    port.board(about).then(
      (board) => {
        if (phase !== "lobby") return;
        lobby = { ...lobby, board };
        emit({ type: "lobby" });
      },
      () => {},
    );
  }

  function topUp(): void {
    const badge = lobby.badge;
    if (!badge) return;
    owe(badge.address, TOPUP_USDC);
    send(
      { kind: "topup", seat: null, direction: "out", amount: TOPUP_USDC },
      (watch) => port.topup(badge.address, watch),
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
    const endedAt = match?.endedAt ?? null;
    if (!sameBadge(seats[seat].badge, badge) || endedAt === null || clock.now() - endedAt < REMATCH_TAP_MS) return "ignored";
    command({ type: "rematch" });
    return "rematch";
  }

  function handleTap(seat: Seat, badge: Badge, at: number, roll: number | null): TapMeaning {
    const seatedHere = sameBadge(seats[seat].badge, badge);
    switch (phase) {
      case "boot":
      case "build":
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
    if (inGame(event.seat, event.badge) && match?.play.game === "built") {
      // A built game hears finished taps: a known badge's now, at its touch, when the game needs no roll; anything
      // else when the chip has answered (its `done`), still judged at the touch.
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
        if (info.kind === "built" ? !ports.rules : !isTeamGame(info.id)) return;
        game = info.id;
        // A built game's child starts now, at Join, so its first step pays no start-up cost.
        if (info.kind === "built") ports.rules?.prepare(info.id);
        if (!info.stakes.includes(stake)) {
          stake = defaultStake(info);
          emit({ type: "stake", amount: stake });
        }
        setPhase(bothSeated() ? "stake" : "join");
        return;
      }
      case "stake":
        if (phase !== "stake" || !nobodySigned() || cmd.amount === stake) return;
        if (!game || !gameOf(game)?.stakes.includes(cmd.amount)) return;
        stake = cmd.amount;
        emit({ type: "stake", amount: stake });
        return;
      case "back":
        if (phase === "lobby") setPhase(lobby.from === "stake" && bothSeated() && game ? "stake" : "home");
        else if (phase === "join" || phase === "build" || (phase === "stake" && nobodySigned())) setPhase("home");
        return;
      case "rematch":
        if (phase !== "result") return;
        fitSeatsToOpponent();
        if (game && gameOf(game)?.kind === "built") ports.rules?.prepare(game);
        setPhase(bothSeated() ? "stake" : "join");
        return;
      case "home":
        // From Refund too: a pot left unrefunded is refunded by the server once its delay has run.
        if (phase === "result" || phase === "build" || phase === "refund" || phase === "lobby") setPhase("home");
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
    if (!gameOf(focus) && games[0]) focus = games[0].id;
    emit({ type: "games" });
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
      // A pot that never settles stays on chain until its refund opens; the server refunds it then. A result already
      // decided is still sent once its pot lands.
      setPhase("home");
    },
    stop() {
      stopBuilt();
      ports.rules?.stop();
      timers.clear();
      book.stop();
      unwatchLibrary();
      unwatchHead();
    },
  };
}
