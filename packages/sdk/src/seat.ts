/** A seat at the Box: 0 is Player 1 (left, orange), 1 is Player 2 (right, cyan). */
export type Seat = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1];

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}
