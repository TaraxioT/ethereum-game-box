// How full the gas bar is: pure, so it is tested without a DOM.

export const SEGMENTS = 16;
const MAX_GWEI = 5;

/** How many of the bar's segments a value lights: 0 to 16, in proportion to 0–5 gwei. */
export function litSegments(gwei: number): number {
  if (!(gwei > 0)) return 0;
  return Math.min(SEGMENTS, Math.round((gwei / MAX_GWEI) * SEGMENTS));
}
