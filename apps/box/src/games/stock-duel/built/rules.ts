// Stock Duel as a built game: the form the Forge starts a new game from. Four stocks each on a turning Rolodex; a
// badge tap plays the card in front, both badges' verified rolls choose the stat, and the higher number takes the
// round. First to two rounds; if a hand runs out first, the leader wins (level is a draw).
//
// A tap is judged at its touch time (`now`): it plays the card the player saw in front then, SHOW_LAG_MS before the
// touch (the screen turns a card half a turn after the drum steps). Once one seat has played, the other has one turn
// of its drum; then its front card is played for it, with its last roll. The stat is chosen only after both cards
// are down: chosen first, it would hand the round to whoever plays second.
import { hash32, other, shuffle, stationView, type BuiltEvent, type BuiltRules, type Outcome, type Seat, type StationView } from "@egb/sdk";
import { DECK, formatStat, STAT_LABEL, STATS, type StatKey, type Stock } from "./deck.ts";

export const DEAL_MS = 3000;
/** The two cards face up and the stat chosen, before the next round. */
export const REVEAL_MS = 5000;
export const SHOW_LAG_MS = 240;
/** How long each card stays at the front of the Rolodex, by round; later rounds keep the last. */
export const DWELL_MS: readonly number[] = [2400, 2100, 1800];
export const HAND_SIZE = 4;
export const ROUNDS_TO_WIN = 2;

export type Phase = "deal" | "pick" | "reveal" | "over";

export interface RoundRecord {
  readonly cards: readonly [Stock, Stock];
  readonly stat: StatKey;
  /** null: a tie, replayed with the next cards. */
  readonly winner: Seat | null;
}

export interface StockDuelState {
  /** The Box's clock at the last event: the stations show the drums as of then. */
  readonly now: number;
  readonly phase: Phase;
  /** When the phase began. */
  readonly phaseAt: number;
  /** 1-based play number (ties count). */
  readonly round: number;
  readonly score: readonly [number, number];
  readonly hands: readonly [readonly Stock[], readonly Stock[]];
  readonly dwellMs: number;
  /** When each seat's drum last started from its first card: the front card follows from the clock. */
  readonly drumAt: readonly [number, number];
  readonly played: readonly [Stock | null, Stock | null];
  /** The card was played for the seat when its time ran out. */
  readonly auto: readonly [boolean, boolean];
  /** Once one seat has played: when the other's card is played for it. */
  readonly deadline: number | null;
  /** Each seat's latest roll (uint32); the seed's until its badge rolls. */
  readonly rolls: readonly [number, number];
  readonly stat: StatKey | null;
  readonly history: readonly RoundRecord[];
  /** Set when phase is `over`: null is a draw. */
  readonly winner: Seat | null;
}

type Pair<T> = readonly [T, T];
const put = <T>(pair: Pair<T>, seat: Seat, value: T): Pair<T> => (seat === 0 ? [value, pair[1]] : [pair[0], value]);
const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const dwellForRound = (round: number): number => DWELL_MS[Math.min(round, DWELL_MS.length) - 1] ?? 2400;

/** Both drums start together, Player 2's one card ahead, so the two fronts never match. */
const drumStart = (now: number, dwellMs: number): Pair<number> => [now, now - dwellMs];

/** The index of a seat's front card at `now`: its played card once down, else the one the clock shows. */
export function frontIndex(state: StockDuelState, seat: Seat, now: number): number {
  const hand = state.hands[seat];
  const played = state.played[seat];
  if (played) return Math.max(0, hand.indexOf(played));
  if (hand.length === 0) return 0;
  const at = state.phase === "deal" ? state.phaseAt : now;
  return mod(Math.floor((at - state.drumAt[seat]) / state.dwellMs), hand.length);
}

const frontCard = (state: StockDuelState, seat: Seat, now: number): Stock | null => state.hands[seat][frontIndex(state, seat, now)] ?? null;

function start(seed: number, now: number): StockDuelState {
  const deck = shuffle(DECK, seed);
  const dwellMs = dwellForRound(1);
  return {
    now,
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

/** Both cards down: the rolls choose the stat, the higher number takes the round. */
function reveal(state: StockDuelState, now: number): StockDuelState {
  const [a, b] = state.played;
  if (!a || !b) return state;
  const stat = STATS[((state.rolls[0] + state.rolls[1]) >>> 0) % STATS.length] ?? "price";
  const difference = a[stat] - b[stat];
  const winner: Seat | null = difference > 0 ? 0 : difference < 0 ? 1 : null;
  return {
    ...state,
    phase: "reveal",
    phaseAt: now,
    stat,
    score: winner === null ? state.score : put(state.score, winner, state.score[winner] + 1),
    history: [...state.history, { cards: [a, b], stat, winner }],
  };
}

function play(state: StockDuelState, seat: Seat, card: Stock, at: number, roll: number | null): StockDuelState {
  const partner = other(seat);
  const waiting = state.played[partner] === null;
  return {
    ...state,
    played: put(state.played, seat, card),
    auto: put(state.auto, seat, roll === null),
    rolls: roll === null ? state.rolls : put(state.rolls, seat, roll),
    // One turn of the other drum: it comes back round to the same front card, and that one is played for it.
    deadline: waiting ? at + state.dwellMs * state.hands[partner].length : state.deadline,
  };
}

/** Plays the front card, at the deadline, for a seat whose time ran out. */
function settle(state: StockDuelState, now: number): StockDuelState {
  const { deadline } = state;
  if (state.phase !== "pick" || deadline === null || now < deadline) return state;
  let next = state;
  for (const seat of [0, 1] as const) {
    const card = next.played[seat] === null ? frontCard(next, seat, deadline) : null;
    if (card) next = play(next, seat, card, deadline, null);
  }
  return reveal(next, now);
}

/** The cards played leave the hands; then the match is over, or the next round begins. */
function advance(state: StockDuelState, now: number): StockDuelState {
  const hands: StockDuelState["hands"] = [state.hands[0].filter((c) => c !== state.played[0]), state.hands[1].filter((c) => c !== state.played[1])];
  const [one, two] = state.score;
  if (one >= ROUNDS_TO_WIN || two >= ROUNDS_TO_WIN || hands[0].length === 0 || hands[1].length === 0) {
    return { ...state, phase: "over", phaseAt: now, hands, winner: one > two ? 0 : two > one ? 1 : null };
  }
  const round = state.round + 1;
  const dwellMs = dwellForRound(round);
  return { ...state, phase: "pick", phaseAt: now, round, hands, dwellMs, drumAt: drumStart(now, dwellMs), played: [null, null], auto: [false, false], deadline: null, stat: null };
}

function tick(state: StockDuelState, now: number): StockDuelState {
  const elapsed = now - state.phaseAt;
  switch (state.phase) {
    case "deal":
      return elapsed >= DEAL_MS ? { ...state, phase: "pick", phaseAt: now, drumAt: drumStart(now, state.dwellMs) } : state;
    case "pick":
      return settle(state, now);
    case "reveal":
      return elapsed >= REVEAL_MS ? advance(state, now) : state;
    case "over":
      return state;
  }
}

function apply(state: StockDuelState, event: BuiltEvent): StockDuelState {
  if (event.type === "tick") return tick(state, event.now);
  const settled = settle(state, event.now);
  if (settled.phase !== "pick" || settled.played[event.seat] !== null) return settled;
  // The card the player saw in front when the badge touched.
  const card = frontCard(settled, event.seat, Math.max(settled.phaseAt, event.now - SHOW_LAG_MS));
  if (!card) return settled;
  const next = play(settled, event.seat, card, event.now, event.roll ?? hash32(event.now, event.seat));
  return next.played[0] && next.played[1] ? reveal(next, event.now) : next;
}

function step(state: StockDuelState, event: BuiltEvent): StockDuelState {
  const next = apply(state, event);
  return { ...next, now: Math.max(state.now, event.now) };
}

/** Printable ASCII for a station: the stat's minus sign becomes a hyphen. */
const ascii = (text: string): string => text.replace(/−/g, "-");

function station(state: StockDuelState, seat: Seat): StationView {
  const now = state.now;
  const tag = seat === 0 ? "P1" : "P2";
  const played = state.played[seat];
  const score = `${state.score[0]} - ${state.score[1]}`;
  switch (state.phase) {
    case "deal":
      return stationView(tag, "DEAL", `round ${state.round}  ${score}`);
    case "pick":
      return played ? stationView(tag, "PLAYED", played.ticker) : stationView(tag, frontCard(state, seat, now - SHOW_LAG_MS)?.ticker ?? "", "tap to play", { sign: "HOLD STILL|rolling" });
    case "reveal":
      return played && state.stat ? stationView(tag, played.ticker, ascii(`${STAT_LABEL[state.stat]} ${formatStat(state.stat, played[state.stat])}`)) : stationView(tag, "REVEAL", "");
    case "over":
      return stationView(tag, state.winner === null ? "DRAW" : state.winner === seat ? "WIN" : "LOSE", score);
  }
}

const rules: BuiltRules<StockDuelState> = {
  start,
  step,
  outcome: (state): Outcome | null => (state.phase === "over" ? { winner: state.winner } : null),
  // The Box ticks the rules many times a second, so the stations' front cards keep up with the drums.
  stations: (state) => [station(state, 0), station(state, 1)],
};

export default rules;
