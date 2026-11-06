// Who is playing, from the seats. A match's players are the seats with a badge, in seat order: a store game can start
// with a seat empty, and that seat sits the match out. So its log, its page, its pot and its payouts count players, and a
// player's place in this list isn't always their seat. In a two-player game the two are the same. Pure.
import type { Seat } from "@egb/sdk";
import type { Badge } from "./types.ts";

/** The seats with a badge, in seat order: a player's place in a match is their index here. */
export function playerSeats(seats: readonly { readonly badge: Badge | null }[]): Seat[] {
  return seats.flatMap((seat, i) => (seat.badge ? [i as Seat] : []));
}

/** Every player has signed the stake. */
export function allSigned(seats: readonly { readonly badge: Badge | null; readonly signed: boolean }[]): boolean {
  const players = seats.filter((seat) => seat.badge);
  return players.length > 0 && players.every((seat) => seat.signed);
}
