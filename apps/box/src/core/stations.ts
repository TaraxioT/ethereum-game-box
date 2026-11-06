// What each tap station's OLED shows, from the Box's state. Pure. A station shows its seat's tag (`P1`), a big line
// (≤ 32 characters) and a small one (≤ 40), scrolling when too wide, the overrides for a tap in progress, and its mode:
// what a tap means now, from the seat's tap plan. `@egb/sdk`'s `stationView` cuts each line to what the station holds.
// A station whose seat isn't in play says so: past the seats on show, or left empty once a match is under way.
import type { DuelSeat, Seat, Seated, StationMode, StationView } from "@egb/sdk";
import { DUEL_SEATS, isDuelSeat, SEATS, stationView as fitView } from "@egb/sdk";
import type { Match, SeatState, StorePlay } from "./types.ts";
import type { QuickDrawState } from "../games/quick-draw/types.ts";
import type { StockDuelState } from "../games/stock-duel/types.ts";
import { reactionMs } from "../games/quick-draw/rules.ts";
import { frontCard, SHOW_LAG_MS } from "../games/stock-duel/rules.ts";
import { formatStat, STAT_LABEL } from "../games/stock-duel/deck.ts";
import { playerName } from "./badges.ts";
import { stakeOf } from "./catalogue.ts";
import { tapPlan, type PlanInput } from "./plan.ts";
import { allSigned, playerSeats } from "./seats.ts";

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

/** A seated player: their whole ENS name on the big line (it scrolls past in big letters), the balance under it. */
function seated(state: SeatState): Lines {
  return state.badge ? lines(playerName(state.badge, state.ens), usdc(state.balance)) : lines("TAP", "to join");
}

/** A seat with nobody in it while a match is under way. */
const sitsOut = lines("NEXT", "next match");

function staking(input: StationInput, mine: SeatState): Lines {
  if (!mine.badge) return sitsOut;
  if (!mine.signed) {
    const amount = `${stakeOf(input.playFor, input.stake)} USDC`;
    return lines("SIGN", input.playFor === "usdc" ? amount : `${amount} ${input.playFor}`);
  }
  return lines("SIGNED", allSigned(input.seats) ? "opening" : "waiting");
}

function quickDraw(game: QuickDrawState, seat: DuelSeat): Lines {
  if (game.phase === "wait") return lines("WAIT", "tap on DRAW");
  if (game.phase === "draw") {
    const tapped = game.taps[seat];
    return tapped === null ? lines("DRAW!", "tap now") : lines("DRAW!", `${Math.round(tapped - game.drawAt)} ms`);
  }
  const ms = reactionMs(game, seat);
  const detail = ms !== null ? `${Math.round(ms)} ms` : game.taps[seat] !== null ? "too early" : "no tap";
  return lines(game.winner === seat ? "WIN" : "LOSE", detail);
}

function stockDuel(game: StockDuelState, seat: DuelSeat, now: number): Lines {
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

/** A store match, by the player's `place`: the line the game set over its title, then the judge's word, then what they were paid. */
function store(match: Match, play: StorePlay, place: number): Lines {
  if (match.outcome === null) return lines(play.lines[place] ?? "", play.title);
  if (play.judged?.step === "refunded") return lines("REFUNDED", `+${match.stake} USDC`);
  const paid = play.judged?.step === "paid" ? play.judged.payouts?.[place] : undefined;
  return paid === undefined ? lines("JUDGING", "by AI") : lines(`+${paid} USDC`, "paid");
}

function refunding(match: Match, now: number): Lines {
  if (match.refunded.every(Boolean)) return lines("REFUNDED", `+${match.stake} USDC`);
  const left = match.refundAt - now;
  return left > 0 ? lines("OFFLINE", wait(left)) : lines("TAP", "to refund");
}

function idle(input: StationInput, seat: Seat, now: number): Lines {
  const { phase, match } = input;
  if (phase === "boot") return lines("", "");
  if (phase === "attract") return lines("TAP", "to start");
  if (phase === "build") return lines("NEW GAME", "being designed");
  if (phase === "lobby") return lines("LOBBY", "tap to see yours");
  const mine = input.seats[seat];
  if (!mine) return lines("NEXT", `this game seats ${input.seats.length}`);
  if (phase === "home" || phase === "join") return seated(mine);
  if (phase === "stake") return staking(input, mine);
  if (!match) return seated(mine);
  if (match.play.game === "store" && !mine.badge) return sitsOut;
  if (phase === "refund") return refunding(match, now);
  if (match.voided) return lines("VOID", "stakes back");
  if (match.play.game === "store") return store(match, match.play, playerSeats(input.seats).indexOf(seat));
  if (!isDuelSeat(seat)) return sitsOut;
  if (match.play.game === "built") return lines(match.play.stations[seat].big, match.play.stations[seat].small);
  return match.play.game === "quick-draw" ? quickDraw(match.play.state, seat) : stockDuel(match.play.state, seat, now);
}

/** What a tap at the seat means now: nothing (`shut`, the station refuses it itself), a game's move, or anything else. */
function modeOf(input: StationInput, seat: Seat, now: number): StationMode {
  const plan = tapPlan(input, seat, now);
  if (plan === "none") return "shut";
  return input.phase === "playing" ? "play" : "open";
}

/** One station's OLED. `now` places Stock Duel's Rolodex. */
export function stationView(input: StationInput, seat: Seat, now: number): StationView {
  const { match } = input;
  const mode = modeOf(input, seat, now);
  // A built game's stations are its rules' own, tag and tap words included.
  if ((input.phase === "playing" || input.phase === "result") && match?.play.game === "built" && !match.voided && isDuelSeat(seat)) return { ...match.play.stations[seat], mode };
  const { big, small } = idle(input, seat, now);
  if (input.phase === "boot") return fitView("", big, small, { mode });
  const mine = input.seats[seat];
  const extra: { done?: string; sign?: string; mode: StationMode } = { mode };
  // The station's own tap feedback names the seated player by their whole ENS name, big, beside the check mark (it
  // scrolls); a roll is a signature on the chip, so it says so. A tap that isn't welcome gets the station's own NOT NOW.
  if (mine?.badge) extra.done = playerName(mine.badge, mine.ens);
  if (tapPlan(input, seat, now) === "random") extra.sign = "HOLD STILL|rolling";
  return fitView(`P${seat + 1}`, big, small, extra);
}

/** Every station's OLED, for a Box with `stations` of them. */
export function stationViews(input: StationInput, now: number, stations: number = DUEL_SEATS.length): Seated<StationView> {
  const view = (seat: Seat): StationView => stationView(input, seat, now);
  return [view(0), view(1), ...SEATS.slice(2, stations).map(view)];
}
