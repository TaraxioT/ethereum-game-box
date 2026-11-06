// What each tap station's OLED shows, from the Box's state. Pure. A station shows its seat's tag (`P1`), a big line
// (≤ 10 characters) and a small one (≤ 20), and the overrides for a tap in progress; `@egb/sdk`'s `stationView` cuts
// each line to what the station holds.
import type { Seat, StationView } from "@egb/sdk";
import { stationView as fitView } from "@egb/sdk";
import type { Match, SeatState } from "./types.ts";
import type { QuickDrawState } from "../games/quick-draw/types.ts";
import type { StockDuelState } from "../games/stock-duel/types.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { formatStat, STAT_LABEL } from "../games/stock-duel/deck.ts";
import { badgeLabel } from "./badges.ts";
import { tapPlan, type PlanInput } from "./plan.ts";

/** Everything a station view reads: the Box's state without the station views themselves. */
export type StationInput = PlanInput;

/** The idle lines of one station; the tag and the tap overrides are added by `stationView`. */
interface Lines {
  readonly big: string;
  readonly small: string;
}

const lines = (big: string, small: string): Lines => ({ big, small });

/** Printable ASCII only: the stat's minus sign becomes a hyphen. */
const ascii = (text: string): string => text.replace(/−/g, "-");

/** `wait 59 min`, or seconds in the last minute. */
function wait(ms: number): string {
  return ms >= 60_000 ? `wait ${Math.ceil(ms / 60_000)} min` : `wait ${Math.ceil(ms / 1000)} s`;
}

/** Whole USDC as a station prints it, or `...` before the first read. */
const usdc = (amount: number | null): string => (amount === null ? "... USDC" : `${Math.floor(amount)} USDC`);

function seated(state: SeatState): Lines {
  return state.badge ? lines(badgeLabel(state.badge), usdc(state.balance)) : lines("TAP", "to join");
}

function staking(input: StationInput, seat: Seat): Lines {
  const mine = input.seats[seat];
  if (!mine.badge) return seated(mine);
  if (!mine.signed) return lines("SIGN", `${input.stake} USDC`);
  const bothSigned = input.seats[0].signed && input.seats[1].signed;
  return lines("SIGNED", bothSigned ? "opening" : "waiting");
}

function quickDraw(game: QuickDrawState, seat: Seat): Lines {
  if (game.phase === "wait") return lines("WAIT", "tap on DRAW");
  if (game.phase === "draw") {
    const tapped = game.taps[seat];
    return tapped === null ? lines("DRAW!", "tap now") : lines("DRAW!", `${Math.round(tapped - game.drawAt)} ms`);
  }
  const ms = reactionMs(game, seat);
  const detail = ms !== null ? `${Math.round(ms)} ms` : game.taps[seat] !== null ? "too early" : "no tap";
  return lines(game.winner === seat ? "WIN" : "LOSE", detail);
}

function stockDuel(game: StockDuelState, seat: Seat, now: number): Lines {
  const played = game.played[seat];
  switch (game.phase) {
    case "deal":
      return lines("DEAL", `round ${game.round}  ${game.score[0]}-${game.score[1]}`);
    case "pick":
      if (played) return lines("PLAYED", played.ticker);
      // The card the big screen shows in front, which is the card a tap plays.
      return lines(frontCard(game, seat, Math.max(game.phaseAt, now - SHOW_LAG_MS))?.ticker ?? "", "tap to play");
    case "dial":
      return lines("DIAL", played?.ticker ?? "");
    case "reveal":
      if (!played || !game.stat) return lines("REVEAL", "");
      return lines(played.ticker, ascii(`${STAT_LABEL[game.stat]} ${formatStat(game.stat, played[game.stat])}`));
    case "over": {
      const outcome = game.winner === null ? "DRAW" : game.winner === seat ? "WIN" : "LOSE";
      return lines(outcome, `${game.score[0]} - ${game.score[1]}`);
    }
  }
}

function refunding(match: Match, seat: Seat, now: number): Lines {
  if (match.refunded[seat]) return lines("REFUNDED", `+${match.stake} USDC`);
  const left = match.refundAt - now;
  return left > 0 ? lines("OFFLINE", wait(left)) : lines("TAP", "to refund");
}

function idle(input: StationInput, seat: Seat, now: number): Lines {
  const mine = input.seats[seat];
  const { match } = input;
  switch (input.phase) {
    case "boot":
      return lines("", "");
    case "attract":
      return lines("TAP", "to start");
    case "build":
      return lines("NEW GAME", "being designed");
    case "home":
    case "join":
      return seated(mine);
    case "stake":
      return staking(input, seat);
    case "playing":
    case "result":
      if (!match) return seated(mine);
      if (match.voided) return lines("VOID", "stakes back");
      if (match.play.game === "built") return lines(match.play.stations[seat].big, match.play.stations[seat].small);
      return match.play.game === "quick-draw" ? quickDraw(match.play.state, seat) : stockDuel(match.play.state, seat, now);
    case "refund":
      return match ? refunding(match, seat, now) : seated(mine);
    case "lobby":
      return lines("LOBBY", "tap to see yours");
  }
}

/** One station's OLED. `now` places Stock Duel's Rolodex. */
export function stationView(input: StationInput, seat: Seat, now: number): StationView {
  const { match } = input;
  // A built game's stations are its rules' own, tag and tap words included.
  if ((input.phase === "playing" || input.phase === "result") && match?.play.game === "built" && !match.voided) return match.play.stations[seat];
  const { big, small } = idle(input, seat, now);
  if (input.phase === "boot") return fitView("", big, small);
  const badge = input.seats[seat].badge;
  const extra: { done?: string; sign?: string } = {};
  // The station's own tap feedback names the seated player; a roll is a signature on the chip, so it says so.
  if (badge) extra.done = `DONE|${badgeLabel(badge)}`;
  if (tapPlan(input, seat, now) === "random") extra.sign = "HOLD STILL|rolling";
  return fitView(`P${seat + 1}`, big, small, extra);
}

export function stationViews(input: StationInput, now: number): readonly [StationView, StationView] {
  return [stationView(input, 0, now), stationView(input, 1, now)];
}
