// The simulated Box: the phase machine, composed from the catalogue, chain clock, ledger, transactions, stations and
// bot, behind BoxLink and SimControl. Time comes from Date.now() and timers, so fake timers drive it in tests.
import type {
  Badge,
  BoxEvent,
  BoxState,
  Cue,
  GameId,
  Match,
  MatchPlay,
  Phase,
  PlayableGameId,
  ScreenCommand,
  SeatState,
} from "../types.ts";
import type { Opponent, SimLink } from "./control.ts";
import type { Seat } from "@egb/sdk";
import { SEATS } from "@egb/sdk";
import { hash32, mulberry32 } from "@egb/sdk";
import { rules as quickDraw } from "../../../games/quick-draw/rules.ts";
import { frontIndex, rules as stockDuel, SHOW_LAG_MS } from "../../../games/stock-duel/rules.ts";
import { defaultStake, DEFAULT_FOCUS, GAMES, gameInfo } from "./catalogue.ts";
import { blockAt, DRIFT_MS, firstGas, GAS_DRIFT, nextBlockAt, nextGas, BLOCK_MS } from "./chain.ts";
import { balanceOf, EMPTY_LEDGER, faucet, FAUCET_EGB, lock, refund, settle, type Ledger } from "./ledger.ts";
import { createTxBook } from "./txs.ts";
import { BOT_BADGE, DESK_BADGES } from "./badges.ts";
import { stationViews, type StationInput } from "./stations.ts";
import { createBot } from "./bot.ts";

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

type TapResult = "accepted" | "ignored" | "refused";

interface SeatSlot {
  badge: Badge | null;
  signed: boolean;
}

function sameBadge(a: Badge | null, b: Badge | null): boolean {
  return a !== null && b !== null && a.address === b.address;
}

function isPlayable(id: GameId): id is PlayableGameId {
  return id === "quick-draw" || id === "stock-duel";
}

function startPlay(game: PlayableGameId, seed: number, now: number): MatchPlay {
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

function createTimers() {
  const handles = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  return {
    after(ms: number, run: () => void): ReturnType<typeof setTimeout> {
      const handle = setTimeout(() => {
        handles.delete(handle);
        run();
      }, ms);
      handles.add(handle);
      return handle;
    },
    every(ms: number, run: () => void): ReturnType<typeof setInterval> {
      const handle = setInterval(run, ms);
      intervals.add(handle);
      return handle;
    },
    cancel(handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null): void {
      if (handle === null) return;
      clearTimeout(handle);
      clearInterval(handle);
      handles.delete(handle);
      intervals.delete(handle);
    },
    clear(): void {
      for (const handle of handles) clearTimeout(handle);
      for (const handle of intervals) clearInterval(handle);
      handles.clear();
      intervals.clear();
    },
  };
}

export function createSimLink(options: { seed?: number } = {}): SimLink {
  const seed = (options.seed ?? Date.now()) >>> 0;
  const rnd = mulberry32(seed);
  const timers = createTimers();
  const listeners = new Set<(state: BoxState, event: BoxEvent) => void>();

  let phase: Phase = "boot";
  let focus: GameId = DEFAULT_FOCUS;
  const seats: [SeatSlot, SeatSlot] = [
    { badge: null, signed: false },
    { badge: null, signed: false },
  ];
  let stake = defaultStake(gameInfo(DEFAULT_FOCUS));
  let game: PlayableGameId | null = null;
  let match: Match | null = null;
  let matchCount = 0;
  let ledger: Ledger = EMPTY_LEDGER;
  /** Faucet payments signed but not yet in a block, by address. */
  /** EGB on its way to each address: faucet, payout and refund transactions not yet in a block. */
  const incoming = new Map<string, number>();
  const fauceting = new Set<string>();
  /** Refund transactions sent and not yet landed, by seat. */
  const refunding: [boolean, boolean] = [false, false];
  let openTxId: number | null = null;
  let opponent: Opponent = "bot";
  let power = true;

  const head = blockAt(Date.now());
  const chain = { block: head.block, blockAt: head.at, gasGwei: firstGas(rnd) };

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let lastFronts: readonly [number | null, number | null] = [null, null];

  const book = createTxBook({
    step(tx) {
      emit({ type: "tx", tx });
      if (tx.id === openTxId && tx.step === "in-block" && tx.block !== null) openMatch(tx.block);
    },
    // A `tx` event for a transaction no longer in `txs` tells the screen it left.
    drop(tx) {
      emit({ type: "tx", tx });
    },
  });

  const bot = createBot({
    badge: BOT_BADGE,
    state: () => state,
    active: () => opponent === "bot",
    tap: () => press(1, BOT_BADGE),
    rnd: mulberry32(hash32("bot", seed)),
  });

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
      games: GAMES,
      focus,
      seats: [seatState(0), seatState(1)],
      chain: { block: chain.block, blockAt: chain.blockAt, blockMs: BLOCK_MS, gasGwei: chain.gasGwei },
      stake,
      match,
      txs: book.list(),
    };
    return { ...input, stations: stationViews(input, Date.now()) };
  }

  let state = snapshot();

  function emit(event: BoxEvent): void {
    state = snapshot();
    for (const listener of [...listeners]) listener(state, event);
    bot.update();
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
    const isBot = sameBadge(badge, BOT_BADGE);
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
      ledger = faucet(ledger, address, amount);
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
    const otherSeat: Seat = seat === 0 ? 1 : 0;
    if (sameBadge(seats[otherSeat].badge, badge)) clearSeat(otherSeat);
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
        ledger = lock(ledger, both, amount);
      }).id;
    }
    return "accepted";
  }

  function openMatch(block: number): void {
    openTxId = null;
    if (!game) throw new Error("no game was chosen");
    const [one, two] = addresses();
    const id = ++matchCount;
    const play = startPlay(game, hash32("match", id, one, two, block), Date.now());
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
    lastFronts = fronts(play, Date.now());
    setPhase("playing");
    cue("boot");
    tickTimer = timers.every(TICK_MS, () => stepGame(null));
    // The draw lands on its exact moment, not on the next tick, so reaction times are fair to the millisecond.
    if (play.game === "quick-draw") timers.after(Math.max(0, play.state.drawAt - Date.now()), () => stepGame(null));
  }

  // ── Playing ───────────────────────────────────────────────────────────────────────────────────────────────────

  function nextPlay(play: MatchPlay, tapSeat: Seat | null, now: number): MatchPlay {
    if (play.game === "quick-draw") {
      const next = quickDraw.step(play.state, tapSeat === null ? { type: "tick", now } : { type: "tap", seat: tapSeat, now });
      return next === play.state ? play : { game: "quick-draw", state: next };
    }
    // A badge's tap carries its own signed randomness: a fresh uint32 per tap.
    const next = stockDuel.step(
      play.state,
      tapSeat === null ? { type: "tick", now } : { type: "tap", seat: tapSeat, now, roll: Math.floor(rnd() * 2 ** 32) >>> 0 },
    );
    return next === play.state ? play : { game: "stock-duel", state: next };
  }

  /** Steps the game with a tick (tapSeat null) or a tap. Returns whether the game changed. */
  function stepGame(tapSeat: Seat | null): boolean {
    if (!match || match.outcome) return false;
    const now = Date.now();
    const before = match.play;
    const after = nextPlay(before, tapSeat, now);
    const changed = after !== before;
    const outcome = changed ? outcomeOf(after) : null;
    if (changed) match = { ...match, play: after, outcome };
    const cues = playCues(before, after, lastFronts, now);
    lastFronts = fronts(after, now);
    // The Rolodex turns with the clock, so the stations can change while the game state does not.
    const stationsMoved = JSON.stringify(snapshot().stations) !== JSON.stringify(state.stations);
    if (changed || stationsMoved) emit({ type: "game" });
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
      ledger = settle(ledger, both, amount, winner);
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
      ledger = refund(ledger, address, amount);
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

  function handleTap(seat: Seat, badge: Badge): TapResult {
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
        return seatedHere && stepGame(seat) ? "accepted" : "ignored";
      case "refund":
        return seatedHere ? claimRefund(seat) : "ignored";
    }
  }

  function press(seat: Seat, badge: Badge): void {
    const result = handleTap(seat, badge);
    emit({ type: "tap", seat, accepted: result === "accepted" });
    emit({ type: "buzz", seat });
    if (result === "accepted") cue("tap");
    if (result === "refused") cue("error");
  }

  /** With the bot playing, Player 2's seat is the bot's. */
  function botHolds(seat: Seat): boolean {
    if (seat !== 1 || opponent !== "bot") return false;
    const badge = seats[1].badge;
    return badge === null || sameBadge(badge, BOT_BADGE);
  }

  function deskBadgeFor(seat: Seat): Badge | null {
    const seated = seats[seat].badge;
    if (seated) return seated;
    return DESK_BADGES.find((badge) => !seats.some((slot) => sameBadge(slot.badge, badge))) ?? null;
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
        if (phase !== "home" || cmd.game === focus || !GAMES.some((info) => info.id === cmd.game)) return;
        focus = cmd.game;
        emit({ type: "focus", game: focus });
        return;
      case "play": {
        const info = gameInfo(focus);
        if (phase !== "home" || !info.ready || !isPlayable(info.id)) return;
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
        if (!game || !gameInfo(game).stakes.includes(cmd.amount)) return;
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
    const now = Date.now();
    timers.after(nextBlockAt(now) - now, () => {
      // The next block is armed first, so nothing a block sets off can stop the chain.
      scheduleBlock();
      const sealed = blockAt(Date.now());
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

  return {
    badges: [...DESK_BADGES, BOT_BADGE],
    botBadge: BOT_BADGE,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send: command,
    tap(seat, badge) {
      if (botHolds(seat)) return;
      const chosen = badge ?? deskBadgeFor(seat);
      if (chosen) press(seat, chosen);
    },
    opponent: () => opponent,
    setOpponent(next) {
      if (next === opponent) return;
      opponent = next;
      if (outsideMatch()) {
        fitSeatsToOpponent();
        if (phase === "stake" && !bothSeated()) setPhase("join");
      }
      bot.update();
    },
    power: () => power,
    setPower(on) {
      power = on;
    },
    stop() {
      timers.clear();
      book.stop();
      bot.stop();
    },
  };
}
