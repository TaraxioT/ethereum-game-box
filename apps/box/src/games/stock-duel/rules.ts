// Stock Duel's rules: deal four stocks each, play a card from a spinning Rolodex, let both badges' rolls choose the
// stat, and the higher number takes the round. First to two rounds; if the hands run out first the leader wins.
import type { GameRules, Outcome } from "../game.ts";
import { hash32, shuffle } from "../random.ts";
import { other, SEATS, type Seat } from "../seat.ts";
import { DECK, STATS } from "./deck.ts";
import type { RoundRecord, Stock, StockDuelEvent, StockDuelState } from "./types.ts";

export const DEAL_MS = 3000;
export const DIAL_MS = 2800;
export const REVEAL_MS = 4200;
/** The screen shows a new front card this long after the drum steps (half its turn), so a tap is judged at
 * `now - SHOW_LAG_MS`: the card the player saw in front is the card they play. */
export const SHOW_LAG_MS = 240;
/** How long each card stays at the front of the Rolodex, by round. Later rounds keep the last. */
export const DWELL_MS: readonly number[] = [2400, 2100, 1800];

const HAND_SIZE = 4;
const ROUNDS_TO_WIN = 2;

type Pair<T> = readonly [T, T];

function put<T>(pair: Pair<T>, seat: Seat, value: T): Pair<T> {
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

/** Which card in a seat's hand is at the front: its played card once it has played, else the one the clock shows. */
export function frontIndex(state: StockDuelState, seat: Seat, now: number): number {
  const hand = state.hands[seat];
  if (hand.length === 0) return 0;
  const played = state.played[seat];
  if (played !== null) {
    const index = hand.indexOf(played);
    if (index >= 0) return index;
  }
  const turns = Math.floor((clockAt(state, now) - state.drumAt[seat]) / state.dwellMs);
  return mod(turns, hand.length);
}

export function frontCard(state: StockDuelState, seat: Seat, now: number): Stock | null {
  return state.hands[seat][frontIndex(state, seat, now)] ?? null;
}

/** How long the front card stays in front before the drum turns: the draining ring. Zero once the seat has played. */
export function frontRemainingMs(state: StockDuelState, seat: Seat, now: number): number {
  if (state.played[seat] !== null || state.hands[seat].length === 0) return 0;
  const sinceTurn = mod(clockAt(state, now) - state.drumAt[seat], state.dwellMs);
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
    rolls: [hash32(seed, 0), hash32(seed, 1)],
    stat: null,
    history: [],
    winner: null,
  };
}

/** Puts a seat's card down. `roll` is the badge's number for a tap; a card played for a seat keeps its old roll. */
function play(state: StockDuelState, seat: Seat, card: Stock, at: number, auto: boolean, roll?: number): StockDuelState {
  const partner = other(seat);
  const partnerWaiting = state.played[partner] === null;
  return {
    ...state,
    played: put(state.played, seat, card),
    auto: put(state.auto, seat, auto),
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

/** Plays the front card for a seat whose time ran out. It is judged at the deadline, not at the late `now`. */
function settlePick(state: StockDuelState, now: number): StockDuelState {
  const { deadline } = state;
  if (state.phase !== "pick" || deadline === null || now < deadline) return state;
  let next = state;
  for (const seat of SEATS) {
    if (next.played[seat] !== null) continue;
    const card = frontCard(next, seat, deadline);
    if (card !== null) next = play(next, seat, card, deadline, true);
  }
  return closePick(next, now);
}

function tap(state: StockDuelState, seat: Seat, now: number, roll: number): StockDuelState {
  const settled = settlePick(state, now);
  if (settled.phase !== "pick" || settled.played[seat] !== null) return settled;
  const card = frontCard(settled, seat, Math.max(settled.phaseAt, now - SHOW_LAG_MS));
  if (card === null) return settled;
  return closePick(play(settled, seat, card, now, false, roll), now);
}

/** Compares the two played cards on the chosen stat. Higher wins; equal is a tie. */
function reveal(state: StockDuelState, now: number): StockDuelState {
  const [a, b] = state.played;
  const { stat } = state;
  if (a === null || b === null || stat === null) return state;
  const difference = a[stat] - b[stat];
  const winner: Seat | null = difference > 0 ? 0 : difference < 0 ? 1 : null;
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
    const winner: Seat | null = one > two ? 0 : two > one ? 1 : null;
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
    return event.type === "tick" ? tick(state, event.now) : tap(state, event.seat, event.now, event.roll);
  },
  outcome(state): Outcome | null {
    return state.phase === "over" ? { winner: state.winner } : null;
  },
};
