// What each tap station's OLED shows, from the Box's state. Pure. Lines stay inside the 128×64 panel: at most
// LINE_CHARS on the small lines and BIG_CHARS on the big one.
import type { BoxState, Match, SeatState, StationView } from "../types.ts";
import type { Seat } from "@egb/sdk";
import type { QuickDrawState } from "../../../games/quick-draw/types.ts";
import type { StockDuelState } from "../../../games/stock-duel/types.ts";
import { reactionMs } from "../../../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../../../games/stock-duel/rules.ts";
import { formatStat, STAT_LABEL } from "../../../games/stock-duel/deck.ts";
import { badgeLabel } from "./badges.ts";

export const LINE_CHARS = 16;
export const BIG_CHARS = 8;

/** Everything a station view reads: the Box's state without the station views themselves. */
export type StationInput = Omit<BoxState, "stations">;

function view(top: string, big: string, bottom: string): StationView {
  return { top: top.slice(0, LINE_CHARS), big: big.slice(0, BIG_CHARS), bottom: bottom.slice(0, LINE_CHARS) };
}

const BLANK = view("", "", "");

function playerTitle(seat: Seat): string {
  return `PLAYER ${seat + 1}`;
}

function nameOf(seat: Seat, state: SeatState): string {
  return state.badge ? badgeLabel(state.badge) : playerTitle(seat);
}

function blocks(n: number): string {
  return `${n} BLOCK${n === 1 ? "" : "S"}`;
}

function seated(seat: Seat, state: SeatState): StationView {
  if (!state.badge) return view(playerTitle(seat), "TAP", "TO JOIN");
  return view(playerTitle(seat), badgeLabel(state.badge), `${state.balance} EGB`);
}

function staking(input: StationInput, seat: Seat): StationView {
  const mine = input.seats[seat];
  if (!mine.badge) return seated(seat, mine);
  const name = badgeLabel(mine.badge);
  if (!mine.signed) return view(name, "SIGN", `${input.stake} EGB`);
  const bothSigned = input.seats[0].signed && input.seats[1].signed;
  return view(name, "SIGNED", bothSigned ? "OPENING" : "WAITING");
}

function quickDraw(game: QuickDrawState, seat: Seat, name: string): StationView {
  if (game.phase === "wait") return view(name, "WAIT", "TAP ON DRAW");
  if (game.phase === "draw") return view(name, "TAP!", "DRAW!");
  const ms = reactionMs(game, seat);
  const won = game.winner === seat;
  const detail = ms !== null ? `${ms} MS` : game.taps[seat] !== null ? "TOO EARLY" : "NO TAP";
  return view(name, won ? "WIN" : "LOSE", detail);
}

function stockDuel(game: StockDuelState, seat: Seat, name: string, now: number): StationView {
  const round = `ROUND ${game.round}  ${game.score[0]}-${game.score[1]}`;
  const played = game.played[seat];
  switch (game.phase) {
    case "deal":
      return view(round, "DEAL", "GET READY");
    case "pick":
      if (played) return view(round, "PLAYED", played.ticker);
      // The card the big screen shows in front, which is the card a tap plays.
      return view(round, frontCard(game, seat, Math.max(game.phaseAt, now - SHOW_LAG_MS))?.ticker ?? "", "TAP = PLAY");
    case "dial":
      return view(round, "DIAL", played?.ticker ?? "");
    case "reveal":
      if (!played || !game.stat) return view(round, "REVEAL", "");
      return view(STAT_LABEL[game.stat], played.ticker, formatStat(game.stat, played[game.stat]));
    case "over": {
      const outcome = game.winner === null ? "DRAW" : game.winner === seat ? "WIN" : "LOSE";
      return view(name, outcome, `${game.score[0]} - ${game.score[1]}`);
    }
  }
}

function playing(match: Match, seat: Seat, name: string, now: number): StationView {
  return match.play.game === "quick-draw"
    ? quickDraw(match.play.state, seat, name)
    : stockDuel(match.play.state, seat, name, now);
}

function refunding(input: StationInput, match: Match, seat: Seat, name: string): StationView {
  if (match.refunded[seat]) return view(name, "REFUNDED", `+${match.stake} EGB`);
  const left = match.refundBlock - input.chain.block;
  if (left > 0) return view(name, "OFFLINE", `WAIT ${blocks(left)}`);
  return view(name, "TAP", "REFUND");
}

/** One station's OLED. `now` places Stock Duel's Rolodex. */
export function stationView(input: StationInput, seat: Seat, now: number): StationView {
  const mine = input.seats[seat];
  const name = nameOf(seat, mine);
  const { match } = input;
  switch (input.phase) {
    case "boot":
      return BLANK;
    case "attract":
      return view("GAME BOX", "TAP", "TO START");
    case "home":
    case "join":
      return seated(seat, mine);
    case "stake":
      return staking(input, seat);
    case "playing":
    case "result":
      return match ? playing(match, seat, name, now) : seated(seat, mine);
    case "refund":
      return match ? refunding(input, match, seat, name) : seated(seat, mine);
  }
}

export function stationViews(input: StationInput, now: number): readonly [StationView, StationView] {
  return [stationView(input, 0, now), stationView(input, 1, now)];
}
