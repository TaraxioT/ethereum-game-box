// Stock Duel's rules: deal four stocks each, play a card from a spinning Rolodex, let both badges' rolls choose the
// stat, and the higher number takes the round. First to two rounds; if the hands run out first the leader wins.
import type { GameRules, Outcome } from "@egb/sdk";
import { hash32, shuffle } from "@egb/sdk";
import { other, DUEL_SEATS, type DuelSeat } from "@egb/sdk";
import { DECK, STATS } from "./deck.ts";
import type { HeldCard, RoundRecord, Stock, StockDuelEvent, StockDuelState } from "./types.ts";

export const DEAL_MS = 3000;
export const DIAL_MS = 4400;
export const REVEAL_MS = 4200;
/** The screen shows a new front card this long after the drum steps (half its turn), so a tap is judged at
 * `now - SHOW_LAG_MS`: the card the player saw in front is the card they play. */
export const SHOW_LAG_MS = 240;
/** How long each card stays at the front of the Rolodex, by round. Later rounds keep the last. */
export const DWELL_MS: readonly number[] = [2400, 2100, 1800];
/**
 * A held card whose roll never came back is let go after this long. The taps end every tap in done or fail well
 * before it (a roll is under a second; a request times out at 4 s); this only keeps a lost tap from stalling a round.
 */
export const HOLD_MAX_MS = 6000;

const HAND_SIZE = 4;
/** The rounds a seat must take to win the match (the screen shows a pip for each). */
export const ROUNDS_TO_WIN = 2;

type Pair<T> = readonly [T, T];

function put<T>(pair: Pair<T>, seat: DuelSeat, value: T): Pair<T> {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function dwellForRound(round: number): number {
  return DWELL_MS[Math.min(round, DWELL_MS.length) - 1] ?? DWELL_MS[DWELL_MS.length - 1] ?? 0;
}

/** Both Rolodexes start together, but Player 2's is one card ahead, so the two fronts never match. */
function drumStart(now: number, dwellMs: number): Pair<number> {
  return [now, now - dwellMs];
}

/** The Rolodex does not turn during the deal: it rests where the pick will start. */
function clockAt(state: StockDuelState, now: number): number {
  return state.phase === "deal" ? state.phaseAt : now;
}

/** A seat's held card, unless it has been held past HOLD_MAX_MS. */
function heldAt(state: StockDuelState, seat: DuelSeat, now: number): HeldCard | null {
  const held = state.held[seat];
  return held !== null && now - held.at < HOLD_MAX_MS ? held : null;
}

/**
 * Which card in a seat's hand is at the front: its played card once it has played, the card a touch is holding, else
 * the one the clock shows.
 */
export function frontIndex(state: StockDuelState, seat: DuelSeat, now: number): number {
  const hand = state.hands[seat];
  if (hand.length === 0) return 0;
  const pinned = state.played[seat] ?? heldAt(state, seat, now)?.card ?? null;
  if (pinned !== null) {
    const index = hand.indexOf(pinned);
    if (index >= 0) return index;
  }
  const turns = Math.floor((clockAt(state, now) - state.drumAt[seat]) / state.dwellMs);
  return mod(turns, hand.length);
}

export function frontCard(state: StockDuelState, seat: DuelSeat, now: number): Stock | null {
  return state.hands[seat][frontIndex(state, seat, now)] ?? null;
}

/** How long the front card stays in front before the drum turns: the draining ring. Zero once the seat has played. */
export function frontRemainingMs(state: StockDuelState, seat: DuelSeat, now: number): number {
  if (state.played[seat] !== null || state.hands[seat].length === 0) return 0;
  // A held card's ring stops where the touch caught it.
  const at = heldAt(state, seat, now)?.at ?? clockAt(state, now);
  const sinceTurn = mod(at - state.drumAt[seat], state.dwellMs);
  return state.dwellMs - sinceTurn;
}

function start(seed: number, now: number): StockDuelState {
  const deck = shuffle(DECK, seed);
  const dwellMs = dwellForRound(1);
  return {
    phase: "deal",
    phaseAt: now,
    round: 1,
    score: [0, 0],
    hands: [deck.slice(0, HAND_SIZE), deck.slice(HAND_SIZE, HAND_SIZE * 2)],
    dwellMs,
    drumAt: drumStart(now, dwellMs),
    played: [null, null],
    auto: [false, false],
    deadline: null,
    held: [null, null],
    rolls: [hash32(seed, 0), hash32(seed, 1)],
    stat: null,
    history: [],
    winner: null,
  };
}

/** Puts a seat's card down. `roll` is the badge's number for a tap; a card played for a seat keeps its old roll. */
function play(state: StockDuelState, seat: DuelSeat, card: Stock, at: number, auto: boolean, roll?: number): StockDuelState {
  const partner = other(seat);
  const partnerWaiting = state.played[partner] === null;
  return {
    ...state,
    played: put(state.played, seat, card),
    auto: put(state.auto, seat, auto),
    held: put(state.held, seat, null),
    rolls: roll === undefined ? state.rolls : put(state.rolls, seat, roll),
    // One turn of the other drum: it comes back to the same front card, and that card is then played for them.
    deadline: partnerWaiting ? at + state.dwellMs * state.hands[partner].length : state.deadline,
  };
}

/** Once both cards are down the badges' rolls choose the stat and the dial turns. */
function closePick(state: StockDuelState, now: number): StockDuelState {
  if (state.played[0] === null || state.played[1] === null) return state;
  const stat = STATS[((state.rolls[0] + state.rolls[1]) >>> 0) % STATS.length] ?? null;
  return { ...state, phase: "dial", phaseAt: now, stat };
}

/**
 * Plays the front card for a seat whose time ran out. It is judged at the deadline, not at the late `now`. A seat
 * whose chip is on the reader rolling is waited for: its tap plays the card it holds.
 */
function settlePick(state: StockDuelState, now: number): StockDuelState {
  const { deadline } = state;
  if (state.phase !== "pick" || deadline === null || now < deadline) return state;
  let next = state;
  for (const seat of DUEL_SEATS) {
    if (next.played[seat] !== null) continue;
    if (heldAt(next, seat, now) !== null) return next;
    const card = frontCard(next, seat, deadline);
    if (card !== null) next = play(next, seat, card, deadline, true);
  }
  return closePick(next, now);
}

/** The card the player saw in front when the chip touched: the screen shows a new front SHOW_LAG_MS after the turn. */
function seenAt(state: StockDuelState, seat: DuelSeat, at: number): Stock | null {
  return frontCard(state, seat, Math.max(state.phaseAt, at - SHOW_LAG_MS));
}

function touch(state: StockDuelState, seat: DuelSeat, at: number): StockDuelState {
  if (state.phase !== "pick" || state.played[seat] !== null || state.held[seat] !== null) return state;
  const card = seenAt(state, seat, at);
  return card === null ? state : { ...state, held: put(state.held, seat, { card, at }) };
}

function tap(state: StockDuelState, seat: DuelSeat, at: number, roll: number): StockDuelState {
  const held = state.held[seat];
  const settled = settlePick(state, at);
  if (settled.phase !== "pick" || settled.played[seat] !== null) return release(settled, seat);
  const card = held?.card ?? seenAt(settled, seat, at);
  if (card === null) return release(settled, seat);
  return closePick(play(settled, seat, card, held?.at ?? at, false, roll), at);
}

function release(state: StockDuelState, seat: DuelSeat): StockDuelState {
  return state.held[seat] === null ? state : { ...state, held: put(state.held, seat, null) };
}

/** Compares the two played cards on the chosen stat. Higher wins; equal is a tie. */
function reveal(state: StockDuelState, now: number): StockDuelState {
  const [a, b] = state.played;
  const { stat } = state;
  if (a === null || b === null || stat === null) return state;
  const difference = a[stat] - b[stat];
  const winner: DuelSeat | null = difference > 0 ? 0 : difference < 0 ? 1 : null;
  const record: RoundRecord = { cards: [a, b], stat, winner };
  return {
    ...state,
    phase: "reveal",
    phaseAt: now,
    score: winner === null ? state.score : put(state.score, winner, state.score[winner] + 1),
    history: [...state.history, record],
  };
}

/** Both played cards leave the hands, then the match is over, or the next round begins. */
function advance(state: StockDuelState, now: number): StockDuelState {
  const hands: StockDuelState["hands"] = [
    state.hands[0].filter((card) => card !== state.played[0]),
    state.hands[1].filter((card) => card !== state.played[1]),
  ];
  const [one, two] = state.score;
  const handsEmpty = hands[0].length === 0 || hands[1].length === 0;
  if (one >= ROUNDS_TO_WIN || two >= ROUNDS_TO_WIN || handsEmpty) {
    const winner: DuelSeat | null = one > two ? 0 : two > one ? 1 : null;
    return { ...state, phase: "over", phaseAt: now, hands, winner };
  }
  const round = state.round + 1;
  const dwellMs = dwellForRound(round);
  return {
    ...state,
    phase: "pick",
    phaseAt: now,
    round,
    hands,
    dwellMs,
    drumAt: drumStart(now, dwellMs),
    played: [null, null],
    auto: [false, false],
    deadline: null,
    held: [null, null],
    stat: null,
  };
}

function tick(state: StockDuelState, now: number): StockDuelState {
  const elapsed = now - state.phaseAt;
  switch (state.phase) {
    case "deal":
      return elapsed >= DEAL_MS
        ? { ...state, phase: "pick", phaseAt: now, drumAt: drumStart(now, state.dwellMs) }
        : state;
    case "pick":
      return settlePick(state, now);
    case "dial":
      return elapsed >= DIAL_MS ? reveal(state, now) : state;
    case "reveal":
      return elapsed >= REVEAL_MS ? advance(state, now) : state;
    case "over":
      return state;
  }
}

export const rules: GameRules<StockDuelState, StockDuelEvent> = {
  start,
  step(state, event) {
    switch (event.type) {
      case "tick":
        return tick(state, event.now);
      case "touch":
        return touch(state, event.seat, event.now);
      case "tap":
        return tap(state, event.seat, event.now, event.roll);
      case "release":
        return release(state, event.seat);
    }
  },
  outcome(state): Outcome | null {
    return state.phase === "over" ? { winner: state.winner } : null;
  },
};
