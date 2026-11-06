// What the result screen announces once the result is paid, card by card, in the order it happened in its one
// transaction: the pot paid to the winner, the title (its ENS name now resolving to the winner, how long it lasts and
// how it is lost), and the cup (the points, the winner's place, and what the leader wins at the close). Every fact comes
// from the chain: the `Settlement` read at the receipt, and the game's board for the title's term and the cup's prize.
// Pure, so it is tested without a DOM; `win-reveal.ts` draws and animates the cards.
import type { Seat } from "@egb/sdk";
import type { Board, Match, Settlement } from "../../core/types.ts";
import { recordText } from "../../core/stats.ts";
import { timeLeft } from "./board.ts";
import { cupLabel } from "./play-for.ts";

export type WinKind = "usdc" | "title" | "cup";

export interface WinCard {
  readonly kind: WinKind;
  readonly seat: Seat;
  /** What happened, in a few words: `PAID ON SEPOLIA`, `♛ TITLE TAKEN`, `★ +3 PTS IN MUMBAI-CUP`. */
  readonly kicker: string;
  /** The headline: `+40 USDC`, or the title's or cup's ENS name. */
  readonly big: string;
  /** Who it went to: `→ nova.gamebox.eth`. */
  readonly to: string;
  /** What it means, one printed line each. */
  readonly facts: readonly string[];
}

export interface WinInput {
  readonly match: Pick<Match, "stake" | "outcome">;
  readonly settlement: Settlement;
  /** The game's title, as the screen names it (`Quick Draw`). */
  readonly game: string;
  /** The game's board, read after the result: the title's expiry, the cup's prize, close and leader. */
  readonly board: Board | null;
  /** Each seat's name when the settlement has none (the badge's label). */
  readonly fallback: readonly [string, string];
  /** Box ms. */
  readonly now: number;
}

const ORDINAL = ["1ST", "2ND", "3RD", "4TH", "5TH"];
const ordinal = (rank: number): string => ORDINAL[rank] ?? `${rank + 1}TH`;

/** The cards for a win, in order; none for a draw. */
export function winCards({ match, settlement, game, board, fallback, now }: WinInput): WinCard[] {
  const seat = match.outcome?.winner ?? null;
  if (seat === null) return [];
  const who = settlement.names[seat] ?? fallback[seat];
  const cards: WinCard[] = [];

  if (settlement.paid !== null && settlement.paid > 0) {
    const record = settlement.stats[seat];
    cards.push({
      kind: "usdc",
      seat,
      kicker: "PAID ON SEPOLIA",
      big: `+${settlement.paid} USDC`,
      to: `→ ${who}`,
      facts: [
        `THE WHOLE POT: ${match.stake} USDC FROM EACH PLAYER`,
        `SENT STRAIGHT TO ${who}'S BADGE, IN ONE TRANSACTION`,
        ...(record ? [`STATS ON ENS NOW ${recordText(record).toUpperCase()}`] : []),
      ],
    });
  }

  const title = settlement.title;
  if (title) {
    const held = board?.title && board.title.name === title.name && board.title.holder === who ? board.title : null;
    const left = held ? (held.expires - now) / 1000 : 0;
    cards.push({
      kind: "title",
      seat,
      kicker: title.streak > 1 ? `♛ TITLE DEFENDED · ${title.streak} IN A ROW` : "♛ TITLE TAKEN",
      big: title.name,
      to: `→ ${who}`,
      facts: [
        `ON ENS THIS NAME NOW RESOLVES TO ${who}`,
        left > 0 ? `YOURS FOR ${timeLeft(left)} · EVERY WIN RESETS THE CLOCK` : "EVERY WIN RESETS ITS CLOCK",
        `THE NEXT ${game.toUpperCase()} WINNER TAKES IT · SOULBOUND, NEVER SOLD`,
      ],
    });
  }

  const cup = settlement.cup;
  const place = cup?.places[seat] ?? null;
  if (cup && place) {
    const live = board?.cup && board.cup.name === cup.name ? board.cup : null;
    const lead = live?.standings[0]?.points ?? place.points;
    const close = live && live.ends > now ? ` IN ${timeLeft((live.ends - now) / 1000)}` : "";
    const prize = live && live.prize > 0 ? `${live.prize} USDC AND ` : "";
    cards.push({
      kind: "cup",
      seat,
      kicker: `★ +3 PTS IN ${cupLabel(cup.name)}`,
      big: cup.name,
      to: place.rank === 0 ? `→ ${who} · LEADS WITH ${place.points} PTS` : `${who} · ${ordinal(place.rank)} WITH ${place.points} PTS`,
      facts: [
        place.rank === 0 ? "WHILE YOU LEAD, THIS NAME RESOLVES TO YOU" : `${Math.max(0, lead - place.points)} PTS BEHIND THE LEADER · A WIN IS 3, A DRAW 1`,
        `AT THE CLOSE${close} THE LEADER WINS ${prize}THIS NAME, FOREVER`,
      ],
    });
  }
  return cards;
}
