/**
 * A seat at the Box, one per tap station: 0 is Player 1 (left, orange), 1 is Player 2 (right, cyan), 2 is Player 3 (left,
 * green) and 3 is Player 4 (right, pink). Only a store game seats more than two.
 */
export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** A seat in a two-player game: the team games and built games, whose rules are written for two. */
export type DuelSeat = 0 | 1;

export const DUEL_SEATS: readonly DuelSeat[] = [0, 1];

export function other(seat: DuelSeat): DuelSeat {
  return seat === 0 ? 1 : 0;
}

export function isDuelSeat(seat: Seat): seat is DuelSeat {
  return seat === 0 || seat === 1;
}

/** Which side of the Box a seat stands on, as a two-seat game's seat: Players 1 and 3 on the left, 2 and 4 on the right. */
export function sideOf(seat: Seat): DuelSeat {
  return seat === 0 || seat === 2 ? 0 : 1;
}

/** One each for a list of seats: always the first two, and up to two more. */
export type Seated<T> = readonly [T, T, ...T[]];
