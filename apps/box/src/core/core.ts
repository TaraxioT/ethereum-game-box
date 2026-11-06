// The Box's core: the phase machine, composed from the catalogue, chain clock, ledger, transactions and station
// views, behind BoxLink. It has no DOM, no Node APIs and no clock of its own: everything comes through CorePorts,
// so SimLink runs it in the browser, the Box server on the Pi, and tests on a fake clock.
//
// Taps come in as TapEvents: a `touch`, then `done` or `fail`. A tap is judged at its touch time. A known badge on a
// tap that needs no roll is acted on at its touch (Quick Draw); a tap that needs the chip's roll, or a chip the roster
// didn't know yet, waits for its `done`. A tap that touched before the phase changed never reaches the new phase.
import type { Seat } from "@egb/sdk";
import { hash32, other, SEATS } from "@egb/sdk";
import type { CorePorts, TapEvent, TapPlan, TimerHandle } from "./ports.ts";
import type {
  Badge,
  BoxEvent,
  BoxLink,
  BoxState,
  Cue,
  GameId,
  GameInfo,
  Match,
  MatchPlay,
  Phase,
  ScreenCommand,
  SeatState,
  StationView,
  TeamGameId,
} from "./types.ts";
import { rules as quickDraw } from "../games/quick-draw/rules.ts";
import { frontIndex, rules as stockDuel, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { defaultStake, DEFAULT_FOCUS, isTeamGame } from "./catalogue.ts";
import { blockAt, DRIFT_MS, firstGas, GAS_DRIFT, nextBlockAt, nextGas, BLOCK_MS } from "./chain.ts";
import { balanceOf, faucet, FAUCET_EGB, lock, refund, settle, type Ledger } from "./ledger.ts";
import { createTxBook } from "./txs.ts";
import { stationViews, type StationInput } from "./stations.ts";
import { tapPlan } from "./plan.ts";
import { createTimers } from "./timers.ts";

/** Join waits this long with both seats full before moving on to Stake. */
export const JOIN_SETTLE_MS = 700;
/** Home falls back to attract after this long with no taps or touches. */
export const IDLE_MS = 60_000;
/** How often a running game is stepped. */
export const TICK_MS = 50;
/** A finished game stays on screen this long (the winner, the reaction times, the last seal) before it settles. */
export const END_HOLD_MS = 2_400;
/** Refund goes back to Home this long after both stakes are back. */
export const REFUND_DONE_MS = 2_000;
/** A match may be refunded this many blocks after it opened. */
export const REFUND_AFTER_BLOCKS = 3;
/** A refund opens at least this many blocks after the Box missed its settle. */
export const REFUND_MIN_WAIT_BLOCKS = 2;

/** Who plays Player 2: the bot (the demo) or a person at the second station. */
export type Opponent = "bot" | "hotseat";

export interface CoreOptions {
  /** The bot's badge. With the opponent `bot`, Player 2's seat is the bot's alone. Absent: always hot seat. */
  readonly bot?: Badge;
}

export interface Core extends BoxLink {
  /** A tap at a station: `touch`, then exactly one `done` or `fail`, sharing a tap id from `nextTap`. */
  tap(event: TapEvent): void;
  /** What the next tap at this seat should ask of the badge. */
  plan(seat: Seat): TapPlan;
  /** A fresh tap id. Every source of taps (the stations, injected taps, the demo desk) takes its ids here. */
  nextTap(): number;
  opponent(): Opponent;
  setOpponent(opponent: Opponent): void;
  /** Off: the Box can't settle the match it is running, so it goes to Refund when the game ends. */
  power(): boolean;
  setPower(on: boolean): void;
  /** Stops every timer. */
  stop(): void;
}

type TapResult = "accepted" | "ignored" | "refused";

interface SeatSlot {
  badge: Badge | null;
  signed: boolean;
}

/** A tap between its touch and its done or fail. */
interface OpenTap {
  readonly seat: Seat;
  readonly at: number;
  /** The phase change count at the touch: a tap from before the last change is dropped. */
  readonly epoch: number;
  /** Already judged at its touch. */
  acted: boolean;
}

/** What a tap brings to a game: when the chip touched, and its verified roll when the plan was `random`. */
interface GameTap {
  readonly seat: Seat;
  readonly at: number;
  readonly roll: number | null;
}

function sameBadge(a: Badge | null, b: Badge | null): boolean {
  return a !== null && b !== null && a.address === b.address;
}

function startPlay(game: TeamGameId, seed: number, now: number): MatchPlay {
  return game === "quick-draw"
    ? { game, state: quickDraw.start(seed, now) }
    : { game, state: stockDuel.start(seed, now) };
}

function outcomeOf(play: MatchPlay): Match["outcome"] {
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

/** The sounds a game step makes: the sign or the cards flipping, the drum stepping, a round being scored. */
function playCues(before: MatchPlay, after: MatchPlay, frontsBefore: readonly (number | null)[], now: number): Cue[] {
  const cues: Cue[] = [];
  if (before.game === "quick-draw" && after.game === "quick-draw") {
    if (before.state.phase === "wait" && after.state.phase !== "wait" && after.state.reason !== "early") cues.push("flip");
    if (before.state.phase !== "done" && after.state.phase === "done") cues.push("seal");
  }
  if (before.game === "stock-duel" && after.game === "stock-duel") {
    const frontsAfter = fronts(after, now);
    const stepped = SEATS.some((seat) => {
      const was = frontsBefore[seat];
      const is = frontsAfter[seat];
      return was !== null && was !== undefined && is !== null && is !== was && before.state.round === after.state.round;
    });
    if (stepped) cues.push("tick");
    if (before.state.phase !== "reveal" && after.state.phase === "reveal") cues.push("flip");
    const scored = (state: typeof after.state) => state.score[0] + state.score[1];
    if (scored(after.state) > scored(before.state)) cues.push("seal");
  }
  return cues;
}

/** One game step: a tick (tap null) or a tap. A Stock Duel tap without its badge's roll changes nothing. */
function nextPlay(play: MatchPlay, tap: GameTap | null, now: number): MatchPlay {
  if (play.game === "quick-draw") {
    const next = quickDraw.step(play.state, tap === null ? { type: "tick", now } : { type: "tap", seat: tap.seat, now: tap.at });
    return next === play.state ? play : { game: "quick-draw", state: next };
  }
  if (tap?.roll === null) return play;
  const next =
    tap === null
      ? stockDuel.step(play.state, { type: "tick", now })
      : stockDuel.step(play.state, { type: "tap", seat: tap.seat, now: tap.at, roll: tap.roll });
  return next === play.state ? play : { game: "stock-duel", state: next };
}

const viewKey = (view: StationView): string => JSON.stringify(view);

export function createCore(ports: CorePorts, options: CoreOptions = {}): Core {
  const { clock } = ports;
  const bot = options.bot ?? null;
  const timers = createTimers(clock);
  const listeners = new Set<(state: BoxState, event: BoxEvent) => void>();
  /** The simulated chain's randomness in [0, 1). */
  const rnd = (): number => ports.random() / 2 ** 32;

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
  let game: TeamGameId | null = null;
  let match: Match | null = null;
  let matchCount = 0;
  let ledger: Ledger = ports.ledger.load();
  /** EGB on its way to each address: faucet, payout and refund transactions not yet in a block. */
  const incoming = new Map<string, number>();
  const fauceting = new Set<string>();
  /** Refund transactions sent and not yet landed, by seat. */
  const refunding: [boolean, boolean] = [false, false];
  let openTxId: number | null = null;
  let opponent: Opponent = bot ? "bot" : "hotseat";
  let power = true;
  const open = new Map<number, OpenTap>();
  let tapCount = 0;

  const head = blockAt(clock.now());
  const chain = { block: head.block, blockAt: head.at, gasGwei: firstGas(rnd) };

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
        if (tx.id === openTxId && tx.step === "in-block" && tx.block !== null) openMatch(tx.block);
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

  function setLedger(next: Ledger): void {
    ledger = next;
    ports.ledger.save(next);
  }

  function seatState(seat: Seat): SeatState {
    const { badge, signed } = seats[seat];
    return {
      badge,
      signed,
      balance: badge ? balanceOf(ledger, badge.address) : 0,
      pending: badge ? (incoming.get(badge.address) ?? 0) : 0,
    };
  }

  function snapshot(): BoxState {
    const input: StationInput = {
      phase,
      games,
      focus,
      seats: [seatState(0), seatState(1)],
      chain: { block: chain.block, blockAt: chain.blockAt, blockMs: BLOCK_MS, gasGwei: chain.gasGwei },
      stake,
      match,
      txs: book.list(),
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

  function cue(name: Cue): void {
    emit({ type: "cue", cue: name });
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
    idleTimer = phase === "home" ? timers.after(IDLE_MS, () => setPhase("attract")) : null;
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
    if (to === "home") fitSeatsToOpponent();
    if (to === "stake") fundSeats();
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

  /** What a badge can stake: its balance plus the money already on its way to it. */
  function available(address: string): number {
    return balanceOf(ledger, address) + (incoming.get(address) ?? 0);
  }

  /** A seated badge that can't cover the chosen stake (new, or spent out) gets topped up by the faucet. */
  function fundIfLow(seat: Seat, badge: Badge): void {
    const { address } = badge;
    if (available(address) >= stake || fauceting.has(address)) return;
    const amount = FAUCET_EGB - available(address);
    fauceting.add(address);
    owe(address, amount);
    book.submit({ kind: "faucet", seat, direction: "out", amount }, () => {
      setLedger(faucet(ledger, address, amount));
      land(address, amount);
      fauceting.delete(address);
    });
  }

  function fundSeats(): void {
    for (const seat of SEATS) {
      const badge = seats[seat].badge;
      if (badge) fundIfLow(seat, badge);
    }
  }

  function takeSeat(seat: Seat, badge: Badge): TapResult {
    if (sameBadge(seats[seat].badge, badge)) return "accepted";
    if (!fits(seat, badge)) return "ignored";
    if (sameBadge(seats[other(seat)].badge, badge)) clearSeat(other(seat));
    seats[seat] = { badge, signed: false };
    emit({ type: "seat", seat });
    fundIfLow(seat, badge);
    maybeLeaveJoin();
    return "accepted";
  }

  // ── Stake and open ────────────────────────────────────────────────────────────────────────────────────────────

  function addresses(): [string, string] {
    const [one, two] = seats;
    if (!one.badge || !two.badge) throw new Error("a match needs both seats");
    return [one.badge.address, two.badge.address];
  }

  function sign(seat: Seat): TapResult {
    const mine = seats[seat];
    if (!mine.badge || mine.signed) return "ignored";
    if (available(mine.badge.address) < stake) return "refused";
    mine.signed = true;
    emit({ type: "seat", seat });
    if (seats[0].signed && seats[1].signed) {
      const both = addresses();
      const amount = stake;
      openTxId = book.submit({ kind: "open", seat: null, direction: "in", amount: amount * 2 }, () => {
        setLedger(lock(ledger, both, amount));
      }).id;
    }
    return "accepted";
  }

  function openMatch(block: number): void {
    openTxId = null;
    if (!game) throw new Error("no game was chosen");
    const [one, two] = addresses();
    const id = ++matchCount;
    const now = clock.now();
    // The seed takes fresh randomness, so nobody can work out the draw from the seats and the block.
    const play = startPlay(game, hash32("match", id, one, two, block, ports.random()), now);
    refunding[0] = false;
    refunding[1] = false;
    match = {
      id,
      game,
      stake,
      openedBlock: block,
      refundBlock: block + REFUND_AFTER_BLOCKS,
      play,
      outcome: null,
      refunded: [false, false],
    };
    lastFronts = fronts(play, now);
    setPhase("playing");
    cue("boot");
    tickTimer = timers.every(TICK_MS, () => stepGame(null));
    // The draw lands on its exact moment, not on the next tick, so reaction times are fair to the millisecond.
    if (play.game === "quick-draw") timers.after(Math.max(0, play.state.drawAt - now), () => stepGame(null));
  }

  // ── Playing ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Steps the game with a tick (tap null) or a tap. Returns whether the game changed. */
  function stepGame(tap: GameTap | null): boolean {
    if (!match || match.outcome) return false;
    const now = clock.now();
    const before = match.play;
    const after = nextPlay(before, tap, now);
    const changed = after !== before;
    const outcome = changed ? outcomeOf(after) : null;
    if (changed) match = { ...match, play: after, outcome };
    const cues = playCues(before, after, lastFronts, now);
    lastFronts = fronts(after, now);
    if (changed) emit({ type: "game" });
    // The Rolodex turns with the clock, so the stations can change while the game state does not.
    else if (JSON.stringify(snapshot().stations) !== JSON.stringify(state.stations)) emit({ type: "stations" });
    for (const name of cues) cue(name);
    if (outcome) {
      timers.cancel(tickTimer);
      tickTimer = null;
      timers.after(END_HOLD_MS, conclude);
    }
    return changed;
  }

  /** After the end hold: settle if the Box has power, else it has missed its settle and Refund opens. */
  function conclude(): void {
    if (!match?.outcome) return;
    const { winner } = match.outcome;
    if (!power) {
      match = { ...match, refundBlock: Math.max(match.refundBlock, chain.block + REFUND_MIN_WAIT_BLOCKS) };
      setPhase("refund");
      cue("error");
      return;
    }
    const both = addresses();
    const amount = match.stake;
    const payees = winner === null ? both.map((a) => [a, amount] as const) : [[both[winner], amount * 2] as const];
    for (const [address, sum] of payees) owe(address, sum);
    book.submit({ kind: "settle", seat: winner, direction: "out", amount: amount * 2 }, () => {
      setLedger(settle(ledger, both, amount, winner));
      for (const [address, sum] of payees) land(address, sum);
    });
    setPhase("result");
    if (winner !== null) cue(opponent === "bot" && winner === 1 ? "lose" : "win");
  }

  // ── Refund ────────────────────────────────────────────────────────────────────────────────────────────────────

  function claimRefund(seat: Seat): TapResult {
    if (!match || match.refunded[seat] || refunding[seat] || chain.block < match.refundBlock) return "ignored";
    const address = seats[seat].badge?.address;
    if (!address) return "ignored";
    const amount = match.stake;
    const id = match.id;
    refunding[seat] = true;
    owe(address, amount);
    book.submit({ kind: "refund", seat, direction: "out", amount }, () => {
      setLedger(refund(ledger, address, amount));
      land(address, amount);
      refunding[seat] = false;
      if (!match || match.id !== id) return;
      const refunded: [boolean, boolean] = seat === 0 ? [true, match.refunded[1]] : [match.refunded[0], true];
      match = { ...match, refunded };
      if (refunded[0] && refunded[1]) {
        timers.after(REFUND_DONE_MS, () => {
          if (phase === "refund" && match?.id === id) setPhase("home");
        });
      }
    });
    return "accepted";
  }

  // ── Taps ──────────────────────────────────────────────────────────────────────────────────────────────────────

  function handleTap(seat: Seat, badge: Badge, at: number, roll: number | null): TapResult {
    const seatedHere = sameBadge(seats[seat].badge, badge);
    switch (phase) {
      case "boot":
      case "result":
        return "ignored";
      case "attract":
        setPhase("home");
        return "accepted";
      case "home":
      case "join":
        resetIdle();
        return takeSeat(seat, badge);
      case "stake":
        return seatedHere ? sign(seat) : "ignored";
      case "playing":
        return seatedHere && stepGame({ seat, at, roll }) ? "accepted" : "ignored";
      case "refund":
        return seatedHere ? claimRefund(seat) : "ignored";
    }
  }

  /** Tells the screen and the station how a tap went: one short buzz for an accepted tap, two for any other. */
  function report(seat: Seat, result: TapResult): void {
    const accepted = result === "accepted";
    ports.stations.buzz(seat, accepted ? "ok" : "no");
    emit({ type: "tap", seat, accepted });
    emit({ type: "buzz", seat });
    if (accepted) cue("tap");
    if (result === "refused") cue("error");
  }

  function judge(seat: Seat, badge: Badge, at: number, roll: number | null): void {
    report(seat, handleTap(seat, badge, at, roll));
  }

  function tap(event: TapEvent): void {
    switch (event.phase) {
      case "touch": {
        const entry: OpenTap = { seat: event.seat, at: event.at, epoch, acted: false };
        open.set(event.tap, entry);
        // Judged by its touch: a known badge whose tap needs no roll is acted on now, not when the chip answers.
        if (event.badge && tapPlan(state, event.seat) !== "random") {
          entry.acted = true;
          judge(event.seat, event.badge, event.at, null);
        }
        return;
      }
      case "done": {
        const entry = open.get(event.tap);
        open.delete(event.tap);
        if (!entry || entry.acted) return;
        // A tap that began before the phase changed (a stake tap whose chip answered after the match opened) would
        // land in a phase it was never meant for.
        if (entry.epoch !== epoch) return report(entry.seat, "ignored");
        judge(entry.seat, event.badge, entry.at, event.roll);
        return;
      }
      case "fail": {
        const entry = open.get(event.tap);
        open.delete(event.tap);
        if (entry && !entry.acted) report(entry.seat, "ignored");
        return;
      }
    }
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
        return;
      case "play": {
        const info = gameOf(focus);
        if (phase !== "home" || !info?.ready || !isTeamGame(info.id)) return;
        game = info.id;
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
        fundSeats();
        return;
      case "back":
        if (phase === "join" || (phase === "stake" && nobodySigned())) setPhase("home");
        return;
      case "rematch":
        if (phase !== "result") return;
        fitSeatsToOpponent();
        setPhase(bothSeated() ? "stake" : "join");
        return;
      case "home":
        if (phase === "result") setPhase("home");
        return;
      case "refund":
        if (phase === "refund") for (const seat of SEATS) claimRefund(seat);
        return;
    }
  }

  // ── The clock ─────────────────────────────────────────────────────────────────────────────────────────────────

  function scheduleBlock(): void {
    const now = clock.now();
    timers.after(nextBlockAt(now) - now, () => {
      // The next block is armed first, so nothing a block sets off can stop the chain.
      scheduleBlock();
      const sealed = blockAt(clock.now());
      if (sealed.block > chain.block) {
        chain.block = sealed.block;
        chain.blockAt = sealed.at;
        const gas = nextGas(chain.gasGwei, rnd);
        const gasMoved = gas !== chain.gasGwei;
        chain.gasGwei = gas;
        emit({ type: "block", block: sealed.block });
        cue("block");
        if (gasMoved) emit({ type: "gas", gwei: gas });
        book.seal(sealed.block, sealed.at);
      }
    });
  }

  scheduleBlock();
  timers.every(DRIFT_MS, () => {
    const gas = nextGas(chain.gasGwei, rnd, GAS_DRIFT);
    if (gas === chain.gasGwei) return;
    chain.gasGwei = gas;
    emit({ type: "gas", gwei: gas });
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
    plan: (seat) => tapPlan(state, seat),
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
    stop() {
      timers.clear();
      book.stop();
      unwatchLibrary();
    },
  };
}
