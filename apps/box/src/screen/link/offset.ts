// The link's clock offset: how far the Box's clock is ahead of the screen's. Each message carries the Box's `now` when
// it was sent; it reaches the screen late (the socket, a busy frame), never early, so `boxNow - localNow` only ever
// comes out too small. The largest sample of the last few seconds is the best estimate, and the window lets the
// estimate follow either clock being stepped.

/** Samples older than this are forgotten. */
export const OFFSET_WINDOW_MS = 10_000;

export interface ClockOffset {
  /** A message stamped `boxNow` arrived at `localNow`. */
  sample(boxNow: number, localNow: number): void;
  /** Add to the screen's clock to read the Box's. */
  value(): number;
  /** Forgets every sample (a new connection may be to a restarted Box). */
  reset(): void;
}

export function createClockOffset(windowMs = OFFSET_WINDOW_MS): ClockOffset {
  let samples: { readonly at: number; readonly offset: number }[] = [];
  let best = 0;
  return {
    sample(boxNow, localNow) {
      samples = samples.filter((s) => localNow - s.at <= windowMs);
      samples.push({ at: localNow, offset: boxNow - localNow });
      best = Math.max(...samples.map((s) => s.offset));
    },
    value: () => best,
    reset() {
      samples = [];
    },
  };
}
